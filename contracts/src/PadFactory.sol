// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {PadToken} from "./PadToken.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    IWETH9
} from "./interfaces/IUniswapV3.sol";

/// @title PadFactory
/// @notice Launches fixed-supply tokens onto an ETH bonding curve and graduates each one into a
/// full-range Uniswap v3 position that the factory holds forever (liquidity can never be pulled).
///
/// Economics, all visible on-chain and snapshotted per token at launch so terms never change
/// under a creator:
///   - launch fee:      flat ETH, paid by the launcher, to the protocol.
///   - trade fee:       `tradeFeeBps` of every curve buy and sell, split creator / protocol.
///   - graduation fee:  `graduationFeeBps` of the raised ETH, to the protocol.
///   - LP fees:         the locked Uniswap position keeps earning the 1% pool fee forever;
///                      `collectLpFees` splits it creator / protocol with the same share.
///
/// Curve: constant product over virtual reserves. 800M of the 1B supply is sold on the curve;
/// when the last curve token sells, exactly `targetRaise` ETH has been raised and the pool is
/// seeded at the curve's final price with the remaining supply (any excess is burned).
///
/// Provenance: every launch records the channel it came through. A launch prepared by the
/// platform (the site, or an AI agent over MCP) carries an EIP-712 attestation from `attester`
/// binding the exact token parameters, the creator, and a one-time reference; the contract
/// verifies it and emits `LaunchOrigin`. Launches without one are recorded as direct. Anyone can
/// therefore list every prompt-born token from chain data alone, with no trust in the platform's
/// database: filter `LaunchOrigin` by `channel == CHANNEL_PROMPT`.
contract PadFactory is Ownable2Step, ReentrancyGuard, IERC721Receiver, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant CURVE_SUPPLY = 800_000_000e18;
    uint256 public constant LP_RESERVE = TOTAL_SUPPLY - CURVE_SUPPLY;
    uint256 public constant VIRTUAL_TOKEN = 1_066_000_000e18;

    uint24 public constant POOL_FEE = 10_000;
    int24 internal constant TICK_LOWER = -887_200;
    int24 internal constant TICK_UPPER = 887_200;

    uint256 public constant MAX_LAUNCH_FEE = 0.05 ether;
    uint16 public constant MAX_TRADE_FEE_BPS = 200;
    uint16 public constant MAX_GRADUATION_FEE_BPS = 1_000;

    /// @notice Anti-snipe: buys in the first `SNIPE_WINDOW` seconds after launch pay an extra tax that
    /// starts at `SNIPE_START_BPS` and falls linearly to zero. The only exempt buy is the creator's
    /// initial buy inside the launch transaction itself; no wallet is ever whitelisted.
    uint64 public constant SNIPE_WINDOW = 5;
    uint16 public constant SNIPE_START_BPS = 9_900;
    uint16 internal constant BPS = 10_000;

    /// @notice Launch channels recorded on-chain.
    uint8 public constant CHANNEL_DIRECT = 0;
    uint8 public constant CHANNEL_SITE = 1;
    uint8 public constant CHANNEL_PROMPT = 2;

    bytes32 public constant LAUNCH_TYPEHASH = keccak256(
        "Launch(string name,string symbol,string image,string description,address feeRecipient,address creator,uint8 channel,bytes32 ref,uint64 deadline)"
    );

    // ---------------------------------------------------------------- immutables

    IWETH9 public immutable weth;
    IUniswapV3Factory public immutable v3Factory;
    INonfungiblePositionManager public immutable positionManager;

    /// @notice ETH raised on the curve at the moment it sells out.
    uint256 public immutable targetRaise;
    /// @notice Virtual ETH reserve at launch, derived so the curve sells out at `targetRaise`.
    uint256 public immutable virtualEth;
    uint256 internal immutable k;

    // ---------------------------------------------------------------- config

    address public treasury;
    uint256 public launchFee;
    uint16 public tradeFeeBps;
    uint16 public creatorShareBps;
    uint16 public graduationFeeBps;
    bool public launchesPaused;
    /// @notice Key whose EIP-712 signature marks a launch as prepared through a platform channel.
    address public attester;

    // ---------------------------------------------------------------- state

    struct Curve {
        address creator;
        address feeRecipient;
        uint64 createdAt;
        uint32 index;
        uint16 tradeFeeBps;
        uint16 creatorShareBps;
        uint16 graduationFeeBps;
        bool graduated;
        uint256 ethReserve;
        uint256 tokensSold;
        address pool;
        uint256 lpTokenId;
    }

    struct CreateParams {
        string name;
        string symbol;
        string image;
        string description;
        address feeRecipient;
    }

    /// @notice Optional platform attestation. An empty signature means a direct launch.
    struct Origin {
        uint8 channel;
        bytes32 ref;
        uint64 deadline;
        bytes signature;
    }

    struct TokenOrigin {
        uint8 channel;
        bytes32 ref;
    }

    mapping(address token => Curve) internal _curves;
    address[] public tokens;
    mapping(address token => uint256) public creatorFeesOwed;
    uint256 public protocolFeesOwed;
    mapping(address token => TokenOrigin) public origins;
    mapping(bytes32 ref => bool) public usedRefs;

    /// @dev Pool allowed to call `uniswapV3SwapCallback`; set only for the duration of a swap.
    address private _swapPool;

    // ---------------------------------------------------------------- events

    event TokenCreated(
        address indexed token,
        uint256 indexed index,
        address indexed creator,
        address feeRecipient,
        string name,
        string symbol,
        string image,
        string description
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 ethReserve,
        uint256 tokensSold
    );
    event Graduated(
        address indexed token,
        address pool,
        uint256 lpTokenId,
        uint256 ethToLp,
        uint256 tokensToLp,
        uint256 tokensBurned
    );
    event LaunchOrigin(address indexed token, uint8 indexed channel, bytes32 indexed ref);
    event AttesterUpdated(address attester);
    event CreatorFeesClaimed(address indexed token, address indexed recipient, uint256 amount);
    event LpFeesCollected(address indexed token, uint256 amount0, uint256 amount1);
    event ProtocolFeesWithdrawn(address indexed treasury, uint256 amount);
    event ConfigUpdated(
        address treasury,
        uint256 launchFee,
        uint16 tradeFeeBps,
        uint16 creatorShareBps,
        uint16 graduationFeeBps,
        bool launchesPaused
    );

    // ---------------------------------------------------------------- errors

    error InvalidConfig();
    error InvalidParams();
    error LaunchesPaused();
    error InsufficientPayment();
    error UnknownToken();
    error AlreadyGraduated();
    error NotGraduated();
    error Expired();
    error Slippage();
    error ZeroAmount();
    error TransferFailed();
    error Unauthorized();
    error InvalidOrigin();

    constructor(
        address owner_,
        address treasury_,
        IWETH9 weth_,
        IUniswapV3Factory v3Factory_,
        INonfungiblePositionManager positionManager_,
        uint256 targetRaise_,
        uint256 launchFee_,
        uint16 tradeFeeBps_,
        uint16 creatorShareBps_,
        uint16 graduationFeeBps_,
        address attester_
    ) Ownable(owner_) EIP712("PadFactory", "1") {
        if (targetRaise_ == 0) revert InvalidConfig();
        weth = weth_;
        v3Factory = v3Factory_;
        positionManager = positionManager_;
        targetRaise = targetRaise_;
        virtualEth = (targetRaise_ * (VIRTUAL_TOKEN - CURVE_SUPPLY)) / CURVE_SUPPLY;
        k = virtualEth * VIRTUAL_TOKEN;
        _setConfig(treasury_, launchFee_, tradeFeeBps_, creatorShareBps_, graduationFeeBps_, false);
        attester = attester_;
        emit AttesterUpdated(attester_);
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert Unauthorized();
    }

    // ================================================================ launch

    /// @notice Deploy a token on a fresh curve. `msg.value` pays the launch fee; anything above it
    /// is an initial buy for the caller, executed atomically so nobody can front-run the creator.
    /// `origin` is the platform attestation, or an empty signature for a direct launch.
    function createToken(CreateParams calldata p, uint256 minTokensOut, Origin calldata origin)
        external
        payable
        nonReentrant
        returns (address token)
    {
        if (launchesPaused) revert LaunchesPaused();
        if (msg.value < launchFee) revert InsufficientPayment();
        _validate(p);
        TokenOrigin memory recorded = _verifyOrigin(p, origin);

        token = address(new PadToken(p.name, p.symbol, p.image, p.description, msg.sender, TOTAL_SUPPLY));
        uint256 index = tokens.length;
        tokens.push(token);
        _curves[token] = Curve({
            creator: msg.sender,
            feeRecipient: p.feeRecipient,
            createdAt: uint64(block.timestamp),
            index: uint32(index),
            tradeFeeBps: tradeFeeBps,
            creatorShareBps: creatorShareBps,
            graduationFeeBps: graduationFeeBps,
            graduated: false,
            ethReserve: 0,
            tokensSold: 0,
            pool: address(0),
            lpTokenId: 0
        });
        protocolFeesOwed += launchFee;
        origins[token] = recorded;
        emit TokenCreated(token, index, msg.sender, p.feeRecipient, p.name, p.symbol, p.image, p.description);
        emit LaunchOrigin(token, recorded.channel, recorded.ref);

        uint256 initialBuy = msg.value - launchFee;
        if (initialBuy > 0) _buy(token, initialBuy, minTokensOut, true);
    }

    // ================================================================ trading

    function buy(address token, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        tokensOut = _buy(token, msg.value, minTokensOut, false);
    }

    function sell(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Curve storage c = _live(token);
        if (tokensIn == 0 || tokensIn > c.tokensSold) revert ZeroAmount();

        uint256 fee;
        (ethOut, fee) = _quoteSell(c, tokensIn);
        if (ethOut < minEthOut || ethOut == 0) revert Slippage();

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        c.ethReserve -= ethOut + fee;
        c.tokensSold -= tokensIn;
        _accrueTradeFee(token, c, fee);
        emit Trade(token, msg.sender, false, ethOut, tokensIn, fee, c.ethReserve, c.tokensSold);

        _sendEth(msg.sender, ethOut);
    }

    function _buy(address token, uint256 grossIn, uint256 minTokensOut, bool launchBuy)
        internal
        returns (uint256 tokensOut)
    {
        Curve storage c = _live(token);
        if (grossIn == 0) revert ZeroAmount();

        uint16 feeBps = launchBuy ? c.tradeFeeBps : _buyFeeBps(c);
        (uint256 net, uint256 fee, uint256 out, uint256 refund) = _quoteBuy(c, grossIn, feeBps);
        if (out == 0 || out < minTokensOut) revert Slippage();
        tokensOut = out;

        c.ethReserve += net;
        c.tokensSold += out;
        _accrueTradeFee(token, c, fee);
        IERC20(token).safeTransfer(msg.sender, out);
        emit Trade(token, msg.sender, true, net, out, fee, c.ethReserve, c.tokensSold);

        if (c.tokensSold == CURVE_SUPPLY) _graduate(token, c);
        if (refund > 0) _sendEth(msg.sender, refund);
    }

    function _accrueTradeFee(address token, Curve storage c, uint256 fee) internal {
        uint256 creatorPart = (fee * c.creatorShareBps) / BPS;
        creatorFeesOwed[token] += creatorPart;
        protocolFeesOwed += fee - creatorPart;
    }

    // ================================================================ graduation

    function _graduate(address token, Curve storage c) internal {
        c.graduated = true;
        uint256 reserve = c.ethReserve;
        c.ethReserve = 0;

        // Final curve price: vEth / vTok. The pool is seeded at exactly this price.
        uint256 vEthEnd = virtualEth + reserve;
        uint256 vTokEnd = VIRTUAL_TOKEN - CURVE_SUPPLY;

        uint256 ethToLp = reserve - (reserve * c.graduationFeeBps) / BPS;
        uint256 tokensToLp = (ethToLp * vTokEnd) / vEthEnd;
        if (tokensToLp > LP_RESERVE) {
            tokensToLp = LP_RESERVE;
            ethToLp = (LP_RESERVE * vEthEnd) / vTokEnd;
        }
        protocolFeesOwed += reserve - ethToLp;

        (address pool, uint256 tokenId) = _seedPool(token, ethToLp, tokensToLp, vEthEnd, vTokEnd);
        c.pool = pool;
        c.lpTokenId = tokenId;

        // Whatever did not enter the position is burned (tokens) or accrues to the protocol (ETH).
        uint256 leftoverTokens = IERC20(token).balanceOf(address(this));
        if (leftoverTokens > 0) PadToken(token).burn(leftoverTokens);
        uint256 leftoverWeth = weth.balanceOf(address(this));
        if (leftoverWeth > 0) {
            weth.withdraw(leftoverWeth);
            protocolFeesOwed += leftoverWeth;
        }
        emit Graduated(token, pool, tokenId, ethToLp, tokensToLp, leftoverTokens);
    }

    /// @dev Creates (or repairs) the 1% WETH pool at the curve's final price and mints a full-range
    /// position owned by this contract. Anyone can create the pool before graduation and push its
    /// empty price around for free, so an initialized pool at the wrong price is moved back with a
    /// price-limited swap. Any liquidity sitting in the way trades against us at prices no worse
    /// than the target. Nothing here can revert the graduating buy: a failed swap or mint leaves
    /// the assets to the leftover handling in `_graduate`.
    function _seedPool(address token, uint256 ethToLp, uint256 tokensToLp, uint256 vEthEnd, uint256 vTokEnd)
        internal
        returns (address pool, uint256 tokenId)
    {
        bool tokenIsToken0 = token < address(weth);
        (address token0, address token1) = tokenIsToken0 ? (token, address(weth)) : (address(weth), token);
        uint160 target = _sqrtPriceX96(tokenIsToken0, vEthEnd, vTokEnd);

        weth.deposit{value: ethToLp}();

        pool = v3Factory.getPool(token0, token1, POOL_FEE);
        if (pool == address(0)) pool = v3Factory.createPool(token0, token1, POOL_FEE);

        (uint160 current,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (current == 0) {
            IUniswapV3Pool(pool).initialize(target);
        } else if (current != target) {
            bool zeroForOne = current > target;
            uint256 amountIn = zeroForOne == tokenIsToken0 ? tokensToLp : ethToLp;
            _swapPool = pool;
            try IUniswapV3Pool(pool).swap(address(this), zeroForOne, int256(amountIn), target, "") {} catch {}
            _swapPool = address(0);
        }

        uint256 amount0 = IERC20(token0).balanceOf(address(this));
        uint256 amount1 = IERC20(token1).balanceOf(address(this));
        if (tokenIsToken0) amount0 = Math.min(amount0, tokensToLp);
        else amount1 = Math.min(amount1, tokensToLp);

        IERC20(token0).forceApprove(address(positionManager), amount0);
        IERC20(token1).forceApprove(address(positionManager), amount1);
        try positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        ) returns (
            uint256 id, uint128, uint256, uint256
        ) {
            tokenId = id;
        } catch {}
        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        address pool = _swapPool;
        if (msg.sender != pool || pool == address(0)) revert Unauthorized();
        if (amount0Delta > 0) {
            (bool ok, bytes memory data) = pool.staticcall(abi.encodeWithSignature("token0()"));
            if (!ok) revert TransferFailed();
            IERC20(abi.decode(data, (address))).safeTransfer(pool, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            (bool ok, bytes memory data) = pool.staticcall(abi.encodeWithSignature("token1()"));
            if (!ok) revert TransferFailed();
            IERC20(abi.decode(data, (address))).safeTransfer(pool, uint256(amount1Delta));
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ================================================================ fees

    /// @notice Pay a token's accrued curve-phase creator fees to its fee recipient. Callable by
    /// anyone; the ETH can only ever go to the recipient fixed at launch.
    function claimCreatorFees(address token) external nonReentrant returns (uint256 amount) {
        Curve storage c = _curves[token];
        if (c.createdAt == 0) revert UnknownToken();
        amount = creatorFeesOwed[token];
        if (amount == 0) revert ZeroAmount();
        creatorFeesOwed[token] = 0;
        _sendEth(c.feeRecipient, amount);
        emit CreatorFeesClaimed(token, c.feeRecipient, amount);
    }

    /// @notice Collect the locked position's Uniswap fees and split them creator / protocol.
    function collectLpFees(address token) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Curve storage c = _curves[token];
        if (!c.graduated || c.lpTokenId == 0) revert NotGraduated();
        (amount0, amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: c.lpTokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (address token0, address token1) =
            token < address(weth) ? (token, address(weth)) : (address(weth), token);
        _splitErc20(token0, amount0, c);
        _splitErc20(token1, amount1, c);
        emit LpFeesCollected(token, amount0, amount1);
    }

    function withdrawProtocolFees() external nonReentrant returns (uint256 amount) {
        amount = protocolFeesOwed;
        if (amount == 0) revert ZeroAmount();
        protocolFeesOwed = 0;
        _sendEth(treasury, amount);
        emit ProtocolFeesWithdrawn(treasury, amount);
    }

    function _splitErc20(address asset, uint256 amount, Curve storage c) internal {
        if (amount == 0) return;
        uint256 creatorPart = (amount * c.creatorShareBps) / BPS;
        if (creatorPart > 0) IERC20(asset).safeTransfer(c.feeRecipient, creatorPart);
        if (amount > creatorPart) IERC20(asset).safeTransfer(treasury, amount - creatorPart);
    }

    // ================================================================ admin

    function setConfig(
        address treasury_,
        uint256 launchFee_,
        uint16 tradeFeeBps_,
        uint16 creatorShareBps_,
        uint16 graduationFeeBps_,
        bool launchesPaused_
    ) external onlyOwner {
        _setConfig(treasury_, launchFee_, tradeFeeBps_, creatorShareBps_, graduationFeeBps_, launchesPaused_);
    }

    /// @notice Rotate (or, with address(0), disable) the platform attestation key. Tokens already
    /// launched keep the origin they were recorded with.
    function setAttester(address attester_) external onlyOwner {
        attester = attester_;
        emit AttesterUpdated(attester_);
    }

    function _setConfig(
        address treasury_,
        uint256 launchFee_,
        uint16 tradeFeeBps_,
        uint16 creatorShareBps_,
        uint16 graduationFeeBps_,
        bool launchesPaused_
    ) internal {
        if (
            treasury_ == address(0) || launchFee_ > MAX_LAUNCH_FEE || tradeFeeBps_ > MAX_TRADE_FEE_BPS
                || creatorShareBps_ > BPS || graduationFeeBps_ > MAX_GRADUATION_FEE_BPS
        ) revert InvalidConfig();
        treasury = treasury_;
        launchFee = launchFee_;
        tradeFeeBps = tradeFeeBps_;
        creatorShareBps = creatorShareBps_;
        graduationFeeBps = graduationFeeBps_;
        launchesPaused = launchesPaused_;
        emit ConfigUpdated(
            treasury_, launchFee_, tradeFeeBps_, creatorShareBps_, graduationFeeBps_, launchesPaused_
        );
    }

    // ================================================================ views

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function getCurve(address token) external view returns (Curve memory) {
        return _curves[token];
    }

    /// @notice Curve spot price in wei per whole token (1e18 units). After graduation this is the
    /// final curve price the pool was seeded at; the live price is then the pool's.
    function priceWei(address token) external view returns (uint256) {
        Curve storage c = _curves[token];
        if (c.createdAt == 0) revert UnknownToken();
        uint256 reserve = c.graduated ? targetRaise : c.ethReserve;
        return ((virtualEth + reserve) * 1e18) / (VIRTUAL_TOKEN - c.tokensSold);
    }

    /// @notice Share of the curve sold, in basis points (10000 = graduated).
    function progressBps(address token) external view returns (uint256) {
        Curve storage c = _curves[token];
        if (c.createdAt == 0) revert UnknownToken();
        return (c.tokensSold * BPS) / CURVE_SUPPLY;
    }

    function quoteBuy(address token, uint256 ethIn)
        external
        view
        returns (uint256 tokensOut, uint256 fee, uint256 refund)
    {
        Curve storage c = _live(token);
        (, fee, tokensOut, refund) = _quoteBuy(c, ethIn, _buyFeeBps(c));
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 ethOut, uint256 fee) {
        Curve storage c = _live(token);
        if (tokensIn > c.tokensSold) revert ZeroAmount();
        return _quoteSell(c, tokensIn);
    }

    // ================================================================ internals

    /// @notice Current total buy fee in basis points, including any anti-snipe tax.
    function buyFeeBps(address token) external view returns (uint16) {
        return _buyFeeBps(_live(token));
    }

    function _buyFeeBps(Curve storage c) internal view returns (uint16) {
        uint256 elapsed = block.timestamp - c.createdAt;
        if (elapsed >= SNIPE_WINDOW) return c.tradeFeeBps;
        uint256 snipe = (uint256(SNIPE_START_BPS) * (SNIPE_WINDOW - elapsed)) / SNIPE_WINDOW;
        return uint16(Math.min(uint256(c.tradeFeeBps) + snipe, SNIPE_START_BPS));
    }

    function _quoteBuy(Curve storage c, uint256 grossIn, uint16 feeBps)
        internal
        view
        returns (uint256 net, uint256 fee, uint256 out, uint256 refund)
    {
        fee = (grossIn * feeBps) / BPS;
        net = grossIn - fee;

        uint256 vEth = virtualEth + c.ethReserve;
        uint256 vTok = VIRTUAL_TOKEN - c.tokensSold;
        out = vTok - Math.ceilDiv(k, vEth + net);

        uint256 remaining = CURVE_SUPPLY - c.tokensSold;
        if (out >= remaining) {
            out = remaining;
            net = Math.ceilDiv(k, vTok - out) - vEth;
            uint256 gross = Math.min(Math.ceilDiv(net * BPS, BPS - feeBps), grossIn);
            fee = gross - net;
            refund = grossIn - gross;
        }
    }

    function _quoteSell(Curve storage c, uint256 tokensIn)
        internal
        view
        returns (uint256 ethOut, uint256 fee)
    {
        uint256 vEth = virtualEth + c.ethReserve;
        uint256 vTok = VIRTUAL_TOKEN - c.tokensSold;
        uint256 gross = Math.min(vEth - Math.ceilDiv(k, vTok + tokensIn), c.ethReserve);
        fee = (gross * c.tradeFeeBps) / BPS;
        ethOut = gross - fee;
    }

    function _live(address token) internal view returns (Curve storage c) {
        c = _curves[token];
        if (c.createdAt == 0) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();
    }

    /// @dev A signed origin must come from `attester`, bind these exact parameters and this caller,
    /// be unexpired, and use a reference that has never launched before.
    function _verifyOrigin(CreateParams calldata p, Origin calldata o) internal returns (TokenOrigin memory) {
        if (o.signature.length == 0) return TokenOrigin(CHANNEL_DIRECT, bytes32(0));
        if (o.channel == CHANNEL_DIRECT || o.channel > CHANNEL_PROMPT) revert InvalidOrigin();
        if (block.timestamp > o.deadline || usedRefs[o.ref] || attester == address(0)) {
            revert InvalidOrigin();
        }
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LAUNCH_TYPEHASH,
                    keccak256(bytes(p.name)),
                    keccak256(bytes(p.symbol)),
                    keccak256(bytes(p.image)),
                    keccak256(bytes(p.description)),
                    p.feeRecipient,
                    msg.sender,
                    o.channel,
                    o.ref,
                    o.deadline
                )
            )
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, o.signature);
        if (err != ECDSA.RecoverError.NoError || signer != attester) revert InvalidOrigin();
        usedRefs[o.ref] = true;
        return TokenOrigin(o.channel, o.ref);
    }

    function _validate(CreateParams calldata p) internal pure {
        uint256 n = bytes(p.name).length;
        uint256 s = bytes(p.symbol).length;
        if (
            n == 0 || n > 32 || s == 0 || s > 10 || bytes(p.image).length > 512
                || bytes(p.description).length > 1_000 || p.feeRecipient == address(0)
        ) revert InvalidParams();
    }

    function _sqrtPriceX96(bool tokenIsToken0, uint256 vEth, uint256 vTok) internal pure returns (uint160) {
        // Uniswap price is token1 per token0, in raw units, as a Q64.96 square root.
        uint256 ratioX192 =
            tokenIsToken0 ? Math.mulDiv(vEth, 1 << 192, vTok) : Math.mulDiv(vTok, 1 << 192, vEth);
        return uint160(Math.sqrt(ratioX192));
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
