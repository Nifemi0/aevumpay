// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AevumPay} from "../src/AevumPay.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Deploys AevumPay.
///   - Aevum testnet: uses the real tUSD8. Set AEVUMPAY_TREASURY (receives the 0.5% merchant fee).
///   - Local anvil (chain 31337): deploys MockUSD8 first (public mint faucet); the treasury
///     defaults to anvil account #0 if AEVUMPAY_TREASURY is unset.
///
///   AEVUMPAY_TREASURY=0x… forge script script/DeployAevumPay.s.sol --rpc-url http://127.0.0.1:8545 \
///     --private-key <anvil-account-0> --broadcast
contract DeployAevumPay is Script {
    address constant AEVUM_TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    uint256 constant ANVIL_CHAIN = 31337;
    address constant ANVIL_ACCOUNT_0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function run() external returns (AevumPay pay, address token) {
        address treasury = vm.envOr("AEVUMPAY_TREASURY", address(0));
        if (treasury == address(0)) {
            require(block.chainid == ANVIL_CHAIN, "set AEVUMPAY_TREASURY (the fee address is fixed at deploy)");
            treasury = ANVIL_ACCOUNT_0;
        }

        vm.startBroadcast();
        if (AEVUM_TUSD8.code.length > 0) {
            token = AEVUM_TUSD8;
        } else {
            require(block.chainid == ANVIL_CHAIN, "tUSD8 not found; only local anvil can deploy a mock");
            token = address(new MockUSD8());
        }
        pay = new AevumPay(IERC20(token), treasury);
        vm.stopBroadcast();

        console.log("chainId  ", block.chainid);
        console.log("token    ", token);
        console.log("treasury ", treasury);
        console.log("AevumPay ", address(pay));
    }
}
