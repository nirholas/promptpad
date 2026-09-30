// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {PadFactory} from "../src/PadFactory.sol";
import {IUniswapV3Factory, INonfungiblePositionManager, IWETH9} from "../src/interfaces/IUniswapV3.sol";

/// forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast
///
/// Env: PAD_OWNER, PAD_TREASURY (required). Optional overrides: PAD_TARGET_RAISE_WEI,
/// PAD_LAUNCH_FEE_WEI, PAD_TRADE_FEE_BPS, PAD_CREATOR_SHARE_BPS, PAD_GRADUATION_FEE_BPS.
contract Deploy is Script {
    struct Uniswap {
        address weth;
        address factory;
        address positionManager;
    }

    function run() external returns (PadFactory factory) {
        Uniswap memory u = _uniswap(block.chainid);
        address owner = vm.envAddress("PAD_OWNER");
        address treasury = vm.envAddress("PAD_TREASURY");
        uint256 targetRaise = vm.envOr("PAD_TARGET_RAISE_WEI", uint256(4.2 ether));
        uint256 launchFee = vm.envOr("PAD_LAUNCH_FEE_WEI", uint256(0.002 ether));
        uint16 tradeFeeBps = uint16(vm.envOr("PAD_TRADE_FEE_BPS", uint256(100)));
        uint16 creatorShareBps = uint16(vm.envOr("PAD_CREATOR_SHARE_BPS", uint256(5_000)));
        uint16 graduationFeeBps = uint16(vm.envOr("PAD_GRADUATION_FEE_BPS", uint256(300)));

        vm.startBroadcast();
        factory = new PadFactory(
            owner,
            treasury,
            IWETH9(u.weth),
            IUniswapV3Factory(u.factory),
            INonfungiblePositionManager(u.positionManager),
            targetRaise,
            launchFee,
            tradeFeeBps,
            creatorShareBps,
            graduationFeeBps
        );
        vm.stopBroadcast();

        console2.log("PadFactory", address(factory));
        console2.log("deploy block", block.number);
    }

    function _uniswap(uint256 chainId) internal pure returns (Uniswap memory) {
        if (chainId == 4663) {
            return Uniswap({
                weth: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73,
                factory: 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA,
                positionManager: 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3
            });
        }
        if (chainId == 46630) {
            return Uniswap({
                weth: 0x7943e237c7F95DA44E0301572D358911207852Fa,
                factory: 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865,
                positionManager: 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364
            });
        }
        revert("unsupported chain");
    }
}
