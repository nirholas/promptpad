// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {PadFactory} from "../src/PadFactory.sol";
import {PadToken} from "../src/PadToken.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    IWETH9
} from "../src/interfaces/IUniswapV3.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

/// Runs against a fork of Robinhood Chain mainnet (4663) so graduation exercises the real,
/// deployed Uniswap v3 factory and position manager. Set ROBINHOOD_RPC_URL to run.
contract PadFactoryForkTest is Test {
    IWETH9 constant WETH = IWETH9(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    IUniswapV3Factory constant V3_FACTORY = IUniswapV3Factory(0x1f7d7550B1b028f7571E69A784071F0205FD2EfA);
    INonfungiblePositionManager constant NPM =
        INonfungiblePositionManager(0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3);
    ISwapRouter02 constant ROUTER = ISwapRouter02(0xCaf681a66D020601342297493863E78C959E5cb2);

    uint256 constant TARGET = 4.2 ether;
    uint256 constant LAUNCH_FEE = 0.002 ether;

    PadFactory factory;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address feeWallet = makeAddr("feeWallet");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL"));
        factory = new PadFactory(owner, treasury, WETH, V3_FACTORY, NPM, TARGET, LAUNCH_FEE, 100, 5_000, 300);
        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _launch(uint256 initialBuy) internal returns (address token) {
        vm.prank(creator);
        token = factory.createToken{value: LAUNCH_FEE + initialBuy}(
            PadFactory.CreateParams({
                name: "Signal Coin",
                symbol: "SIG",
                image: "https://example.org/sig.png",
                description: "fork test",
                feeRecipient: feeWallet
            }),
            0
        );
    }

    function _buy(address who, address token, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return factory.buy{value: amount}(token, 0, block.timestamp);
    }

    function test_virtualReservesSellOutAtTarget() public view {
        assertEq(factory.virtualEth(), 1.43325 ether);
    }

    function test_createChargesLaunchFeeAndStoresMetadata() public {
        address token = _launch(0);
        assertEq(factory.tokenCount(), 1);
        assertEq(factory.tokens(0), token);
        assertEq(factory.protocolFeesOwed(), LAUNCH_FEE);
        assertEq(IERC20(token).totalSupply(), 1_000_000_000e18);
        assertEq(IERC20(token).balanceOf(address(factory)), 1_000_000_000e18);
        assertEq(PadToken(token).image(), "https://example.org/sig.png");
        assertEq(PadToken(token).creator(), creator);
        PadFactory.Curve memory c = factory.getCurve(token);
        assertEq(c.feeRecipient, feeWallet);
        assertEq(c.tradeFeeBps, 100);
    }

    function test_createRejectsUnderpayment() public {
        vm.prank(creator);
        vm.expectRevert(PadFactory.InsufficientPayment.selector);
        factory.createToken{value: LAUNCH_FEE - 1}(PadFactory.CreateParams("A", "A", "", "", feeWallet), 0);
    }

    function test_initialBuyGoesToCreator() public {
        address token = _launch(0.1 ether);
        uint256 bal = IERC20(token).balanceOf(creator);
        assertGt(bal, 0);
        assertEq(factory.getCurve(token).ethReserve, 0.099 ether);
        assertEq(factory.creatorFeesOwed(token), 0.0005 ether);
        assertEq(factory.protocolFeesOwed(), LAUNCH_FEE + 0.0005 ether);
    }

    function test_buySellRoundTripLosesOnlyFees() public {
        address token = _launch(0);
        uint256 got = _buy(alice, token, 1 ether);
        (uint256 quoted,) = factory.quoteSell(token, got);
        uint256 before = alice.balance;
        vm.prank(alice);
        factory.sell(token, got, quoted, block.timestamp);
        uint256 back = alice.balance - before;
        assertEq(back, quoted);
        // 1% in, 1% out, plus rounding in the pool's favor.
        assertApproxEqAbs(back, 0.99 ether * 99 / 100, 1e6);
        assertEq(factory.getCurve(token).tokensSold, 0);
        assertLe(factory.getCurve(token).ethReserve, 1e6);
    }

    function test_sellNeedsNoApproval() public {
        address token = _launch(0);
        uint256 got = _buy(alice, token, 0.5 ether);
        assertEq(IERC20(token).allowance(alice, address(factory)), type(uint256).max);
        vm.prank(alice);
        factory.sell(token, got / 2, 0, block.timestamp);
        assertEq(IERC20(token).balanceOf(alice), got - got / 2);
    }

    function test_slippageAndDeadline() public {
        address token = _launch(0);
        (uint256 q,,) = factory.quoteBuy(token, 1 ether);
        vm.prank(alice);
        vm.expectRevert(PadFactory.Slippage.selector);
        factory.buy{value: 1 ether}(token, q + 1, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(PadFactory.Expired.selector);
        factory.buy{value: 1 ether}(token, 0, block.timestamp - 1);
    }

    function test_graduationSeedsLockedPoolAtCurvePrice() public {
        address token = _launch(0);
        _buy(alice, token, 2 ether);

        uint256 before = bob.balance;
        _buy(bob, token, 10 ether);
        uint256 spent = before - bob.balance;

        PadFactory.Curve memory c = factory.getCurve(token);
        assertTrue(c.graduated);
        assertEq(c.tokensSold, factory.CURVE_SUPPLY());
        assertTrue(c.pool != address(0));
        assertGt(c.lpTokenId, 0);
        assertEq(IERC721(address(NPM)).ownerOf(c.lpTokenId), address(factory));
        assertLt(spent, 10 ether, "excess refunded");

        // Nothing is left behind in the factory for this token; unused LP reserve was burned.
        assertEq(IERC20(token).balanceOf(address(factory)), 0);
        assertLt(IERC20(token).totalSupply(), 1_000_000_000e18);
        assertEq(address(factory).balance, factory.protocolFeesOwed() + factory.creatorFeesOwed(token));

        // Pool price equals the curve's final price (vEth / vTok) within a hair.
        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(c.pool).slot0();
        uint256 priceX192 = uint256(sqrtP) * uint256(sqrtP);
        uint256 expectedEthPerToken = ((factory.virtualEth() + TARGET) * 1e18) / (273_000_000e18);
        uint256 ethPerToken =
            token < address(WETH) ? (priceX192 * 1e18) >> 192 : (uint256(1e18) << 192) / priceX192;
        assertApproxEqRel(ethPerToken, expectedEthPerToken, 1e14);

        assertApproxEqRel(factory.priceWei(token), expectedEthPerToken, 1e14);

        vm.prank(alice);
        vm.expectRevert(PadFactory.AlreadyGraduated.selector);
        factory.buy{value: 1 ether}(token, 0, block.timestamp);
    }

    function test_graduationRepairsGriefedPool() public {
        address token = _launch(0);
        bool tokenIsToken0 = token < address(WETH);
        (address t0, address t1) = tokenIsToken0 ? (token, address(WETH)) : (address(WETH), token);
        address pool = V3_FACTORY.createPool(t0, t1, 10_000);
        // Absurd price: a million times off.
        IUniswapV3Pool(pool).initialize(uint160(1 << 96) * 1000);

        _buy(alice, token, 10 ether);
        PadFactory.Curve memory c = factory.getCurve(token);
        assertTrue(c.graduated);
        assertEq(c.pool, pool);
        assertGt(c.lpTokenId, 0);

        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint256 priceX192 = uint256(sqrtP) * uint256(sqrtP);
        uint256 expectedEthPerToken = ((factory.virtualEth() + TARGET) * 1e18) / (273_000_000e18);
        uint256 ethPerToken = tokenIsToken0 ? (priceX192 * 1e18) >> 192 : (uint256(1e18) << 192) / priceX192;
        assertApproxEqRel(ethPerToken, expectedEthPerToken, 1e14);
    }

    function test_feesFlowToCreatorProtocolAndLp() public {
        address token = _launch(0);
        _buy(alice, token, 10 ether);
        PadFactory.Curve memory c = factory.getCurve(token);

        uint256 owed = factory.creatorFeesOwed(token);
        assertGt(owed, 0);
        factory.claimCreatorFees(token);
        assertEq(feeWallet.balance, owed);

        uint256 protocol = factory.protocolFeesOwed();
        // launch fee + half the trade fee + 3% graduation fee on 4.2 ETH at minimum
        assertGt(protocol, LAUNCH_FEE + 0.126 ether);
        factory.withdrawProtocolFees();
        assertEq(treasury.balance, protocol);

        // Trade on the graduated pool, then collect and split the LP fees.
        vm.startPrank(bob);
        WETH.deposit{value: 1 ether}();
        WETH.approve(address(ROUTER), 1 ether);
        ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(address(WETH), token, 10_000, bob, 1 ether, 0, 0)
        );
        vm.stopPrank();

        factory.collectLpFees(token);
        uint256 wethFee = 0.01 ether;
        assertApproxEqAbs(WETH.balanceOf(feeWallet), wethFee / 2, 2);
        assertApproxEqAbs(WETH.balanceOf(treasury), wethFee / 2, 2);
        assertEq(c.lpTokenId, factory.getCurve(token).lpTokenId);
    }

    function test_configIsCappedAndOwned() public {
        vm.expectRevert();
        factory.setConfig(treasury, 0, 100, 5_000, 300, false);

        vm.startPrank(owner);
        vm.expectRevert(PadFactory.InvalidConfig.selector);
        factory.setConfig(treasury, 1 ether, 100, 5_000, 300, false);
        vm.expectRevert(PadFactory.InvalidConfig.selector);
        factory.setConfig(treasury, 0, 500, 5_000, 300, false);
        factory.setConfig(treasury, 0.001 ether, 150, 4_000, 300, true);
        vm.stopPrank();

        vm.prank(creator);
        vm.expectRevert(PadFactory.LaunchesPaused.selector);
        factory.createToken{value: 0.001 ether}(PadFactory.CreateParams("A", "A", "", "", feeWallet), 0);
    }

    function test_existingTokensKeepLaunchTerms() public {
        address token = _launch(0);
        vm.prank(owner);
        factory.setConfig(treasury, LAUNCH_FEE, 200, 0, 1_000, false);
        _buy(alice, token, 1 ether);
        assertEq(factory.creatorFeesOwed(token), 0.005 ether);
    }

    function testFuzz_buyNeverOversells(uint96 a, uint96 b) public {
        address token = _launch(0);
        uint256 x = bound(uint256(a), 1e9, 6 ether);
        uint256 y = bound(uint256(b), 1e9, 6 ether);
        _buy(alice, token, x);
        if (!factory.getCurve(token).graduated) _buy(bob, token, y);
        PadFactory.Curve memory c = factory.getCurve(token);
        assertLe(c.tokensSold, factory.CURVE_SUPPLY());
        if (!c.graduated) {
            assertEq(IERC20(token).balanceOf(address(factory)), 1_000_000_000e18 - c.tokensSold);
        }
    }
}
