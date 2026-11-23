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
    address carol = makeAddr("carol");
    address treasury = makeAddr("treasury");
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");
    address agent;
    uint256 agentKey;

    bytes32 constant MEMO = keccak256("lunch");
    bytes32 constant SALT = keccak256("salt-1");

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        (agent, agentKey) = makeAddrAndKey("agent");
        bob = makeAddr("bob");
        token = new MockUSD8();
        pay = new AevumPay(IERC20(address(token)), treasury);
        token.mint(alice, 100e6);
        token.mint(bob, 50e6);

        vm.prank(alice);
        pay.register("alice");
        vm.prank(bob);
        pay.register("bob");
        vm.prank(carol);
        pay.register("carol");
    }

    function test_constructor_rejectsZeroTreasury() public {
        vm.expectRevert(AevumPay.ZeroAddress.selector);
        new AevumPay(IERC20(address(token)), address(0));
    }

    // ===================== usernames =====================

    function test_register_setsMappingsAndEmits() public {
        address dave = makeAddr("dave");
        vm.expectEmit(true, true, false, true, address(pay));
        emit AevumPay.Registered("dave", dave);
        vm.prank(dave);
        pay.register("dave");

        assertEq(pay.resolve("dave"), dave);
        assertEq(pay.walletOf("dave"), dave);
        assertEq(pay.usernameOf(dave), "dave");
        assertTrue(pay.isUsernameTaken("dave"));
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

    // ===================== pay by username (free) =====================

    function test_payUsername_movesFundsAndRecords() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        uint256 id = pay.payUsername("bob", 10e6, MEMO);
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(token.balanceOf(bob), 60e6);
        assertEq(token.balanceOf(alice), 90e6);
        assertEq(token.balanceOf(address(pay)), 0);
        assertEq(token.balanceOf(treasury), 0, "person-to-person is free");

        AevumPay.Receipt memory r = pay.getReceipt(1);
        assertEq(r.payer, alice);
        assertEq(r.payee, bob);
        assertEq(r.amount, 10e6);
        assertEq(r.productId, 0);
        assertEq(r.memo, MEMO);
        assertEq(r.fee, 0);
        assertEq(r.via, address(0));
        assertEq(pay.nextPaymentId(), 2);
    }

    function test_payUsername_emitsPaid() public {
        vm.startPrank(alice);
        token.approve(address(pay), 10e6);
        vm.expectEmit(true, true, true, true, address(pay));
        emit AevumPay.Paid(1, alice, bob, 10e6, 0, MEMO, 0);
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

    // ===================== gasless (EIP-3009), payee bound in the nonce =====================

    function _signAuth(uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        Signing.Auth memory a = Signing.Auth({
            from: alice,
            to: address(pay),
            value: value,
            validAfter: 0,
            validBefore: validBefore,
            nonce: nonce
        });
        return Signing.signReceive(vm, aliceKey, token.DOMAIN_SEPARATOR(), a);
    }

    function test_payUsernameWithAuthorization_relayerSubmits() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(10e6, deadline, pay.paymentNonce(bob, 0, MEMO, SALT));

        vm.prank(relayer); // alice never sends a tx
        uint256 id = pay.payUsernameWithAuthorization("bob", 10e6, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));

        assertEq(id, 1);
        assertEq(token.balanceOf(bob), 60e6);
        assertEq(token.balanceOf(alice), 90e6);
        assertEq(token.balanceOf(address(pay)), 0);
        assertEq(pay.getReceipt(1).payee, bob);
    }

    /// The fix in v2: the relayer picks the username argument, but the signature fixes the payee.
    function test_payUsernameWithAuthorization_relayerCannotRedirect() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(10e6, deadline, pay.paymentNonce(bob, 0, MEMO, SALT));

        vm.prank(relayer);
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        pay.payUsernameWithAuthorization("carol", 10e6, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));
        assertEq(token.balanceOf(alice), 100e6);
    }

    function test_payUsernameWithAuthorization_relayerCannotChangeMemo() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(10e6, deadline, pay.paymentNonce(bob, 0, MEMO, SALT));
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        pay.payUsernameWithAuthorization("bob", 10e6, keccak256("other"), AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));
    }

    function test_payUsernameWithAuthorization_noReplay() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(10e6, deadline, pay.paymentNonce(bob, 0, MEMO, SALT));

        pay.payUsernameWithAuthorization("bob", 10e6, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));
        vm.expectRevert(MockUSD8.AuthorizationUsedAlready.selector);
        pay.payUsernameWithAuthorization("bob", 10e6, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));
    }

    function test_payUsernameWithAuthorization_rejectsWrongTo() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = pay.paymentNonce(bob, 0, MEMO, SALT);
        Signing.Auth memory a =
            Signing.Auth({from: alice, to: bob, value: 10e6, validAfter: 0, validBefore: deadline, nonce: nonce});
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, aliceKey, token.DOMAIN_SEPARATOR(), a);

        // AevumPay submits with `to = address(this)`, so a signature addressed to bob no longer matches.
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        pay.payUsernameWithAuthorization("bob", 10e6, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));
    }

    // ===================== stores / products (0.5% fee) =====================

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

    function test_payProduct_splitsFeeAndRecords() public {
        uint256 pid = _openShop();
        uint256 fee = pay.feeFor(4_500_000);
        assertEq(fee, 22_500); // 0.5%

        vm.startPrank(alice);
        token.approve(address(pay), 4_500_000);
        uint256 id = pay.payProduct(pid, MEMO);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 100e6 - 4_500_000);
        assertEq(token.balanceOf(bob), 50e6 + 4_500_000 - fee);
        assertEq(token.balanceOf(treasury), fee);
        assertEq(token.balanceOf(address(pay)), 0);
        AevumPay.Receipt memory r = pay.getReceipt(id);
        assertEq(r.amount, 4_500_000);
        assertEq(r.fee, fee);
        assertEq(r.productId, pid);
    }

    function test_payProductWithAuthorization_feeAndBinding() public {
        uint256 pid = _openShop();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(4_500_000, deadline, pay.paymentNonce(bob, pid, MEMO, SALT));

        vm.prank(relayer);
        uint256 id = pay.payProductWithAuthorization(pid, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));

        uint256 fee = pay.feeFor(4_500_000);
        assertEq(token.balanceOf(bob), 50e6 + 4_500_000 - fee);
        assertEq(token.balanceOf(treasury), fee);
        assertEq(token.balanceOf(address(pay)), 0);
        assertEq(pay.getReceipt(id).fee, fee);
    }

    function test_payProductWithAuthorization_signatureForOtherProductFails() public {
        uint256 pid = _openShop();
        vm.prank(bob);
        uint256 pricey = pay.addProduct("Beans 1kg", 4_500_000);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(4_500_000, deadline, pay.paymentNonce(bob, pid, MEMO, SALT));
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        pay.payProductWithAuthorization(pricey, MEMO, AevumPay.Authorization(alice, 0, deadline, SALT, v, r, s));
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

    // ===================== agent allowances =====================

    function _grant(uint128 budget, uint128 perPayment, uint64 ttl, address[] memory payees) internal {
        vm.startPrank(alice);
        token.approve(address(pay), budget);
        pay.grantAllowance(agent, budget, perPayment, uint64(block.timestamp) + ttl, payees);
        vm.stopPrank();
    }

    function _noPayees() internal pure returns (address[] memory) {
        return new address[](0);
    }

    function _agentPayment(address payee, uint256 productId, uint256 amount, bytes32 nonce)
        internal
        view
        returns (AevumPay.AgentPayment memory p)
    {
        p = AevumPay.AgentPayment({
            payee: payee,
            productId: productId,
            amount: amount,
            memo: MEMO,
            nonce: nonce,
            deadline: block.timestamp + 10 minutes
        });
    }

    function _signAgent(uint256 key, AevumPay.AgentPayment memory p) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, pay.agentPaymentDigest(p));
        return abi.encodePacked(r, s, v);
    }

    function test_agentPay_spendsFromOwnerWithinLimits() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 5e6, "n1");

        vm.prank(relayer); // anyone may submit
        uint256 id = pay.agentPay(p, _signAgent(agentKey, p));

        assertEq(token.balanceOf(alice), 95e6);
        assertEq(token.balanceOf(bob), 55e6);
        assertEq(token.balanceOf(agent), 0, "the agent never holds money");
        assertEq(pay.getAllowance(agent).spent, 5e6);
        AevumPay.Receipt memory r = pay.getReceipt(id);
        assertEq(r.payer, alice);
        assertEq(r.via, agent);
        assertEq(r.fee, 0);
    }

    function test_agentPay_rejectsOverPerPaymentLimit() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 6e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        vm.expectRevert(AevumPay.OverPerPaymentLimit.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_rejectsOverBudget() public {
        _grant(8e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p1 = _agentPayment(bob, 0, 5e6, "n1");
        pay.agentPay(p1, _signAgent(agentKey, p1));
        AevumPay.AgentPayment memory p2 = _agentPayment(bob, 0, 5e6, "n2");
        bytes memory sig = _signAgent(agentKey, p2);
        vm.expectRevert(AevumPay.OverBudget.selector);
        pay.agentPay(p2, sig);
    }

    function test_agentPay_rejectsAfterExpiry() public {
        _grant(20e6, 5e6, 1 days, _noPayees());
        vm.warp(block.timestamp + 1 days);
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        vm.expectRevert(AevumPay.AllowanceExpired.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_rejectsAfterRevoke() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        vm.prank(alice);
        pay.revokeAllowance(agent);
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        vm.expectRevert(AevumPay.AllowanceInactive.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_rejectsReplay() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        pay.agentPay(p, sig);
        vm.expectRevert(AevumPay.NonceUsed.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_rejectsStaleSignature() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        vm.warp(p.deadline + 1);
        vm.expectRevert(AevumPay.SignatureExpired.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_rejectsUnknownSigner() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        (, uint256 otherKey) = makeAddrAndKey("not-an-agent");
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        bytes memory sig = _signAgent(otherKey, p);
        vm.expectRevert(AevumPay.BadSignature.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_tamperedPaymentFails() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        p.payee = carol; // a relayer swaps the payee: recovers a different, unknown signer
        vm.expectRevert(AevumPay.BadSignature.selector);
        pay.agentPay(p, sig);
    }

    function test_agentPay_payeeAllowlist() public {
        address[] memory payees = new address[](1);
        payees[0] = bob;
        _grant(20e6, 5e6, 7 days, payees);

        AevumPay.AgentPayment memory ok = _agentPayment(bob, 0, 1e6, "n1");
        pay.agentPay(ok, _signAgent(agentKey, ok));

        AevumPay.AgentPayment memory no = _agentPayment(carol, 0, 1e6, "n2");
        bytes memory sig = _signAgent(agentKey, no);
        vm.expectRevert(AevumPay.PayeeNotAllowed.selector);
        pay.agentPay(no, sig);
        assertTrue(pay.isAgentPayee(agent, bob));
        assertFalse(pay.isAgentPayee(agent, carol));
    }

    function test_agentPay_regrantResetsSpendAndPayees() public {
        address[] memory payees = new address[](1);
        payees[0] = bob;
        _grant(10e6, 5e6, 7 days, payees);
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 5e6, "n1");
        pay.agentPay(p, _signAgent(agentKey, p));

        _grant(10e6, 5e6, 7 days, _noPayees()); // new grant: no payee list, spend reset
        assertEq(pay.getAllowance(agent).spent, 0);
        assertTrue(pay.isAgentPayee(agent, carol));
    }

    function test_agentPay_productChargesFeeAndExactPrice() public {
        uint256 pid = _openShop();
        _grant(20e6, 5e6, 7 days, _noPayees());

        AevumPay.AgentPayment memory wrong = _agentPayment(bob, pid, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, wrong);
        vm.expectRevert(AevumPay.WrongAmount.selector);
        pay.agentPay(wrong, sig);

        AevumPay.AgentPayment memory p = _agentPayment(bob, pid, 4_500_000, "n2");
        uint256 id = pay.agentPay(p, _signAgent(agentKey, p));
        assertEq(pay.getReceipt(id).fee, pay.feeFor(4_500_000));
        assertEq(token.balanceOf(treasury), pay.feeFor(4_500_000));
    }

    function test_agentPay_onlyRegisteredPayees() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(stranger, 0, 1e6, "n1");
        bytes memory sig = _signAgent(agentKey, p);
        vm.expectRevert(AevumPay.UnknownUser.selector);
        pay.agentPay(p, sig);
    }

    function test_grantAllowance_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(AevumPay.BadAgent.selector);
        pay.grantAllowance(alice, 10e6, 5e6, uint64(block.timestamp + 1 days), _noPayees());
        vm.expectRevert(AevumPay.BadAllowance.selector);
        pay.grantAllowance(agent, 10e6, 11e6, uint64(block.timestamp + 1 days), _noPayees());
        vm.expectRevert(AevumPay.BadAllowance.selector);
        pay.grantAllowance(agent, 10e6, 5e6, uint64(block.timestamp), _noPayees());
        vm.stopPrank();
    }

    function test_grantAllowance_otherOwnerCannotTakeOverLiveAgent() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        vm.prank(bob);
        vm.expectRevert(AevumPay.AgentInUse.selector);
        pay.grantAllowance(agent, 1e6, 1e6, uint64(block.timestamp + 1 days), _noPayees());
    }

    function test_revokeAllowance_onlyOwner() public {
        _grant(20e6, 5e6, 7 days, _noPayees());
        vm.prank(bob);
        vm.expectRevert(AevumPay.NotAllowanceOwner.selector);
        pay.revokeAllowance(agent);
    }

    // ===================== subscriptions =====================

    uint128 constant PLAN_AMOUNT = 10e6;
    uint64 constant PERIOD = 30 days;

    function _plan() internal returns (uint256 planId) {
        vm.startPrank(bob);
        pay.createStore("Bob's Gym");
        planId = pay.createPlan("Monthly", PLAN_AMOUNT, PERIOD);
        vm.stopPrank();
    }

    function _subscribe(uint256 planId, uint32 maxPayments, uint256 approval) internal returns (uint256 subId) {
        vm.startPrank(alice);
        token.approve(address(pay), approval);
        subId = pay.subscribe(planId, maxPayments);
        vm.stopPrank();
    }

    function test_subscribe_chargesFirstPeriodWithFee() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        uint256 fee = pay.feeFor(PLAN_AMOUNT);
        assertEq(token.balanceOf(alice), 90e6);
        assertEq(token.balanceOf(bob), 50e6 + PLAN_AMOUNT - fee);
        assertEq(token.balanceOf(treasury), fee);

        AevumPay.Subscription memory s = pay.getSubscription(subId);
        assertEq(uint8(s.status), uint8(AevumPay.SubStatus.Active));
        assertEq(s.nextDue, block.timestamp + PERIOD);
        assertEq(s.paidCount, 1);
        assertEq(pay.getReceipt(1).subscriptionId, subId);
    }

    function test_collect_notBeforeDue() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        vm.warp(block.timestamp + PERIOD - 1);
        vm.expectRevert(AevumPay.NotDue.selector);
        pay.collect(subId);
    }

    function test_collect_anyoneCanTrigger_moneyGoesToMerchant() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        uint256 bobBefore = token.balanceOf(bob);
        vm.warp(block.timestamp + PERIOD);

        vm.prank(stranger);
        assertTrue(pay.collect(subId));
        assertEq(token.balanceOf(alice), 80e6);
        assertEq(token.balanceOf(bob), bobBefore + PLAN_AMOUNT - pay.feeFor(PLAN_AMOUNT));
        assertEq(token.balanceOf(stranger), 0);

        vm.expectRevert(AevumPay.NotDue.selector); // at most once per period
        pay.collect(subId);
    }

    function test_collect_noBackCharging() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        vm.warp(block.timestamp + 5 * PERIOD + 1 days); // nobody collected for five periods
        assertTrue(pay.collect(subId));
        assertEq(token.balanceOf(alice), 80e6, "only one period charged, not five");

        AevumPay.Subscription memory s = pay.getSubscription(subId);
        assertGt(s.nextDue, block.timestamp);
        vm.expectRevert(AevumPay.NotDue.selector);
        pay.collect(subId);
    }

    function test_collect_insufficientBalance_retriesThenRecovers() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        // Alice spends everything she has left.
        vm.startPrank(alice);
        token.transfer(carol, token.balanceOf(alice));
        vm.stopPrank();

        vm.warp(block.timestamp + PERIOD);
        vm.expectEmit(true, false, false, false, address(pay));
        emit AevumPay.CollectionFailed(subId, 0);
        assertFalse(pay.collect(subId));
        AevumPay.Subscription memory s = pay.getSubscription(subId);
        assertEq(uint8(s.status), uint8(AevumPay.SubStatus.Active), "still in grace");
        assertGt(s.pastDueSince, 0);

        token.mint(alice, 15e6); // tops up during the grace period
        vm.warp(block.timestamp + 1 days);
        assertTrue(pay.collect(subId));
        s = pay.getSubscription(subId);
        assertEq(s.pastDueSince, 0);
        assertEq(s.paidCount, 2);
        assertEq(token.balanceOf(alice), 5e6);
    }

    function test_collect_lapsesAfterGrace() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        vm.startPrank(alice);
        token.transfer(carol, token.balanceOf(alice));
        vm.stopPrank();

        vm.warp(block.timestamp + PERIOD + pay.GRACE_PERIOD());
        assertFalse(pay.collect(subId));
        assertEq(uint8(pay.getSubscription(subId).status), uint8(AevumPay.SubStatus.Lapsed));
        vm.expectRevert(AevumPay.SubscriptionNotActive.selector);
        pay.collect(subId);
    }

    function test_collect_revokedApprovalFailsGracefully() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        vm.prank(alice);
        token.approve(address(pay), 0); // "revoke all"
        vm.warp(block.timestamp + PERIOD);
        assertFalse(pay.collect(subId));
        assertEq(token.balanceOf(alice), 90e6);
    }

    function test_cancel_bySubscriberStopsCharges() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        vm.prank(alice);
        pay.cancelSubscription(subId);
        vm.warp(block.timestamp + PERIOD);
        vm.expectRevert(AevumPay.SubscriptionNotActive.selector);
        pay.collect(subId);
    }

    function test_cancel_byMerchantAllowed_strangerNot() public {
        uint256 subId = _subscribe(_plan(), 0, 100e6);
        vm.prank(stranger);
        vm.expectRevert(AevumPay.NotSubscriptionParty.selector);
        pay.cancelSubscription(subId);
        vm.prank(bob);
        pay.cancelSubscription(subId);
        assertEq(uint8(pay.getSubscription(subId).status), uint8(AevumPay.SubStatus.Cancelled));
    }

    function test_maxPayments_completes() public {
        uint256 subId = _subscribe(_plan(), 2, 100e6);
        vm.warp(block.timestamp + PERIOD);
        assertTrue(pay.collect(subId));
        assertEq(uint8(pay.getSubscription(subId).status), uint8(AevumPay.SubStatus.Completed));
        vm.warp(block.timestamp + PERIOD);
        vm.expectRevert(AevumPay.SubscriptionNotActive.selector);
        pay.collect(subId);
        assertEq(token.balanceOf(alice), 80e6);
    }

    function test_pausedPlan_keepsExistingSubscribers() public {
        uint256 planId = _plan();
        uint256 subId = _subscribe(planId, 0, 100e6);
        vm.prank(bob);
        pay.setPlanActive(planId, false);

        vm.warp(block.timestamp + PERIOD);
        assertTrue(pay.collect(subId), "existing terms still honoured");

        vm.startPrank(carol);
        vm.expectRevert(AevumPay.PlanInactive.selector);
        pay.subscribe(planId, 0);
        vm.stopPrank();
    }

    function test_createPlan_validation() public {
        vm.prank(bob);
        vm.expectRevert(AevumPay.NoStore.selector);
        pay.createPlan("Monthly", PLAN_AMOUNT, PERIOD);

        vm.startPrank(bob);
        pay.createStore("Bob's Gym");
        vm.expectRevert(AevumPay.PeriodTooShort.selector);
        pay.createPlan("Too fast", PLAN_AMOUNT, 59);
        vm.stopPrank();
    }

    function test_subscribe_ownPlanRejected() public {
        uint256 planId = _plan();
        vm.prank(bob);
        vm.expectRevert(AevumPay.SelfPayment.selector);
        pay.subscribe(planId, 0);
    }

    // ===================== invariants-by-example / fuzz =====================

    function testFuzz_payUsername(uint256 amount) public {
        amount = bound(amount, 1, 100e6);
        vm.startPrank(alice);
        token.approve(address(pay), amount);
        pay.payUsername("bob", amount, MEMO);
        vm.stopPrank();
        assertEq(token.balanceOf(bob), 50e6 + amount);
        assertEq(pay.getReceipt(1).amount, amount);
    }

    function testFuzz_feeNeverExceedsHalfPercent(uint256 amount) public view {
        amount = bound(amount, 0, type(uint128).max);
        assertLe(pay.feeFor(amount) * 200, amount);
    }

    function testFuzz_agentNeverExceedsBudget(uint128 budget, uint128 a1, uint128 a2) public {
        budget = uint128(bound(budget, 2, 50e6));
        a1 = uint128(bound(a1, 1, budget));
        a2 = uint128(bound(a2, 1, budget));
        _grant(budget, budget, 7 days, _noPayees());

        AevumPay.AgentPayment memory p1 = _agentPayment(bob, 0, a1, "n1");
        pay.agentPay(p1, _signAgent(agentKey, p1));
        AevumPay.AgentPayment memory p2 = _agentPayment(bob, 0, a2, "n2");
        bytes memory sig = _signAgent(agentKey, p2);
        if (uint256(a1) + a2 > budget) vm.expectRevert(AevumPay.OverBudget.selector);
        pay.agentPay(p2, sig);
        assertLe(pay.getAllowance(agent).spent, budget);
        assertEq(token.balanceOf(alice), 100e6 - pay.getAllowance(agent).spent);
    }

    function testFuzz_registerUsernameTooShort(uint256 len) public {
        len = bound(len, 0, 2);
        bytes memory name = new bytes(len);
        for (uint256 i; i < len; i++) name[i] = "a";
        vm.prank(stranger);
        vm.expectRevert(AevumPay.UsernameTooShort.selector);
        pay.register(string(name));
    }

    function test_contractNeverHoldsBalance() public {
        uint256 pid = _openShop();
        vm.startPrank(alice);
        token.approve(address(pay), 100e6);
        pay.payProduct(pid, MEMO);
        pay.payUsername("bob", 1e6, MEMO);
        vm.stopPrank();
        _grant(5e6, 5e6, 1 days, _noPayees());
        AevumPay.AgentPayment memory p = _agentPayment(bob, 0, 1e6, "n1");
        pay.agentPay(p, _signAgent(agentKey, p));
        assertEq(token.balanceOf(address(pay)), 0);
    }
}
