// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AevumPay} from "../src/AevumPay.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Deploys AevumPay.
///   - Aevum testnet: uses the real tUSD8.
///   - Local anvil (chain 31337): deploys MockUSD8 first (public mint faucet).
///
///   forge script script/DeployAevumPay.s.sol --rpc-url http://127.0.0.1:8545 \
///     --private-key <anvil-account-0> --broadcast
contract DeployAevumPay is Script {
    address constant AEVUM_TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    uint256 constant ANVIL_CHAIN = 31337;

    function run() external returns (AevumPay pay, address token) {
        vm.startBroadcast();
        if (AEVUM_TUSD8.code.length > 0) {
            token = AEVUM_TUSD8;
        } else {
            require(block.chainid == ANVIL_CHAIN, "tUSD8 not found; only local anvil can deploy a mock");
            token = address(new MockUSD8());
        }
        pay = new AevumPay(IERC20(token));
        vm.stopBroadcast();

        console.log("chainId  ", block.chainid);
        console.log("token    ", token);
        console.log("AevumPay ", address(pay));
    }
}
