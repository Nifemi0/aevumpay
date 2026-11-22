// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AevumPay} from "../src/AevumPay.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {Signing} from "./Signing.sol";

contract AevumPayTest is Test {
    MockUSD8 token;
    AevumPay pay;

    address alice;
    uint256 aliceKey;
    address bob;
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    bytes32 constant MEMO = keccak256("lunch");

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        bob = makeAddr("bob");
        token = new MockUSD8();
        pay = new AevumPay(IERC20(address(token)));
        token.mint(alice, 100e6);
        token.mint(bob, 50e6);

        vm.prank(alice);
        pay.register("alice");
        vm.prank(bob);
        pay.register("bob");
    }

    // ===================== usernames =====================

    function test_register_setsMappingsAndEmits() public {
        address carol = makeAddr("carol");
        vm.expectEmit(true, true, false, true, address(pay));
        emit AevumPay.Registered("carol", carol);
        vm.prank(carol);
        pay.register("carol");

        assertEq(pay.resolve("carol"), carol);
        assertEq(pay.walletOf("carol"), carol);
        assertEq(pay.usernameOf(carol), "carol");
        assertTrue(pay.isUsernameTaken("carol"));
    }

    function test_register_revertsOnTaken() public {
        vm.prank(stranger);
        vm.expectRevert(AevumPay.UsernameTaken.selector);
        pay.register("alice");
    }

    function test_register_revertsTooShort() public {
        vm.prank(stranger);
        vm.expectRevert(AevumPay.UsernameTooShort.selector);
        pay.register("ab");
    }

    function test_register_revertsTooLong() public {
        vm.prank(stranger);
        vm.expectRevert(AevumPay.UsernameTooLong.selector);
        pay.register("thisusernameiswaytoolongg");
    }

    function test_register_revertsIfAlreadyRegistered() public {
        vm.prank(alice);
        vm.expectRevert(AevumPay.AlreadyRegistered.selector);
        pay.register("alice2");
    }

    function test_changeUsername_freesOldName() public {
        vm.prank(alice);
        pay.changeUsername("alicia");
        assertEq(pay.resolve("alicia"), alice);
        assertEq(pay.resolve("alice"), address(0));
        assertEq(pay.usernameOf(alice), "alicia");
    }

    function test_changeUsername_revertsIfNotRegistered() public {
        vm.prank(stranger);
        vm.expectRevert(AevumPay.NotRegistered.selector);
        pay.changeUsername("whoever");
    }

    // ===================== pay by username =====================

    function test_payUsername_movesFundsAndRecords() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        uint256 id = pay.payUsername("bob", 10e6, MEMO);
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(token.balanceOf(bob), 60e6);
        assertEq(token.balanceOf(alice), 90e6);
        assertEq(token.balanceOf(address(pay)), 0);

        AevumPay.Receipt memory r = pay.getReceipt(1);
        assertEq(r.payer, alice);
        assertEq(r.payee, bob);
        assertEq(r.amount, 10e6);
        assertEq(r.productId, 0);
        assertEq(r.memo, MEMO);
        assertEq(pay.nextPaymentId(), 2);
    }

    function test_payUsername_emitsPaid() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        vm.expectEmit(true, true, true, true, address(pay));
        emit AevumPay.Paid(1, alice, bob, 10e6, 0, MEMO);
        pay.payUsername("bob", 10e6, MEMO);
        vm.stopPrank();
    }

    function test_payUsername_revertsUnknownUser() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        vm.expectRevert(AevumPay.UnknownUser.selector);
        pay.payUsername("nobody", 10e6, MEMO);
        vm.stopPrank();
    }

    function test_payUsername_revertsZeroAmount() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        vm.expectRevert(AevumPay.ZeroAmount.selector);
        pay.payUsername("bob", 0, MEMO);
        vm.stopPrank();
    }

    function test_payUsername_revertsSelfPayment() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        vm.expectRevert(AevumPay.SelfPayment.selector);
        pay.payUsername("alice", 10e6, MEMO);
        vm.stopPrank();
    }

    function test_payUsername_revertsWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert();
        pay.payUsername("bob", 10e6, MEMO);
    }

    // ===================== gasless (EIP-3009) =====================

    function _signAuth(address from, uint256 key, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        Signing.Auth memory a = Signing.Auth({
            from: from,
            to: address(pay),
            value: value,
            validAfter: 0,
            validBefore: validBefore,
            nonce: nonce
        });
        return Signing.signReceive(vm, key, token.DOMAIN_SEPARATOR(), a);
    }

    function test_payUsernameWithAuthorization_relayerSubmits() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("auth-1");
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(alice, aliceKey, 10e6, deadline, nonce);

        vm.prank(relayer); // alice never sends a tx
        uint256 id = pay.payUsernameWithAuthorization("bob", alice, 10e6, 0, deadline, nonce, MEMO, v, r, s);

        assertEq(id, 1);
        assertEq(token.balanceOf(bob), 60e6);
        assertEq(token.balanceOf(alice), 90e6);
        assertEq(pay.getReceipt(1).payee, bob);
    }

    function test_payUsernameWithAuthorization_noReplay() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("auth-1");
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(alice, aliceKey, 10e6, deadline, nonce);

        pay.payUsernameWithAuthorization("bob", alice, 10e6, 0, deadline, nonce, MEMO, v, r, s);
        vm.expectRevert(MockUSD8.AuthorizationUsedAlready.selector);
        pay.payUsernameWithAuthorization("bob", alice, 10e6, 0, deadline, nonce, MEMO, v, r, s);
    }

    function test_payUsernameWithAuthorization_rejectsWrongTo() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("auth-1");
        // Sign a signature whose `to` is bob, not the contract.
        Signing.Auth memory a = Signing.Auth({
            from: alice,
            to: bob,
            value: 10e6,
            validAfter: 0,
            validBefore: deadline,
            nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, aliceKey, token.DOMAIN_SEPARATOR(), a);

        // AevumPay submits with `to = address(this)`, so a signature addressed to bob no longer matches.
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        pay.payUsernameWithAuthorization("bob", alice, 10e6, 0, deadline, nonce, MEMO, v, r, s);
    }

    // ===================== stores / products =====================

    function _openShop() internal returns (uint256 productId) {
        vm.startPrank(bob);
        pay.createStore("Bob's Coffee");
        productId = pay.addProduct("Flat White", 4_500_000); // 4.5 tUSD8
        vm.stopPrank();
    }

    function test_store_and_product_flow() public {
        uint256 pid = _openShop();
        AevumPay.Store memory s = pay.getStore(bob);
        assertEq(s.name, "Bob's Coffee");
        assertTrue(s.active);

        AevumPay.Product memory p = pay.getProduct(pid);
        assertEq(p.merchant, bob);
        assertEq(p.price, 4_500_000);
        assertTrue(p.active);
    }

    function test_payProduct_movesFundsAndRecords() public {
        uint256 pid = _openShop();
        vm.startPrank(alice);
        token.approve(address(pay), 4_500_000);
        uint256 id = pay.payProduct(pid, MEMO);
        vm.stopPrank();

        assertEq(token.balanceOf(bob), 54_500_000);
        AevumPay.Receipt memory r = pay.getReceipt(id);
        assertEq(r.payer, alice);
        assertEq(r.payee, bob);
        assertEq(r.amount, 4_500_000);
        assertEq(r.productId, pid);
    }

    function test_payProduct_revertsIfInactive() public {
        uint256 pid = _openShop();
        vm.prank(bob);
        pay.setProductActive(pid, false);
        vm.startPrank(alice);
        token.approve(address(pay), 4_500_000);
        vm.expectRevert(AevumPay.ProductInactive.selector);
        pay.payProduct(pid, MEMO);
        vm.stopPrank();
    }

    function test_setProductActive_onlyMerchant() public {
        uint256 pid = _openShop();
        vm.prank(alice);
        vm.expectRevert(AevumPay.NotStoreOwner.selector);
        pay.setProductActive(pid, false);
    }

    function test_payProduct_revertsSelfPayment() public {
        uint256 pid = _openShop();
        vm.startPrank(bob);
        token.approve(address(pay), 4_500_000);
        vm.expectRevert(AevumPay.SelfPayment.selector);
        pay.payProduct(pid, MEMO);
        vm.stopPrank();
    }

    function test_createStore_revertsTwice() public {
        _openShop();
        vm.prank(bob);
        vm.expectRevert(AevumPay.StoreExists.selector);
        pay.createStore("Bob's Other Coffee");
    }

    // ===================== fuzz =====================

    function testFuzz_payUsername(uint256 amount) public {
        amount = bound(amount, 1, 100e6);
        vm.startPrank(alice);
        token.approve(address(pay), amount);
        pay.payUsername("bob", amount, MEMO);
        vm.stopPrank();
        assertEq(token.balanceOf(bob), 50e6 + amount);
        assertEq(pay.getReceipt(1).amount, amount);
    }

    function testFuzz_registerUsernameTooShort(uint256 len) public {
        len = bound(len, 0, 2);
        bytes memory name = new bytes(len);
        for (uint256 i; i < len; i++) name[i] = "a";
        vm.prank(stranger);
        vm.expectRevert(AevumPay.UsernameTooShort.selector);
        pay.register(string(name));
    }
}
