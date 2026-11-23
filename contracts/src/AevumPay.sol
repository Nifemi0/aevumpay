// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice EIP-3009 (USDC-style) signed transfers. tUSD8 on Aevum implements this.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title AevumPay v2
/// @notice Username payments, a storefront, agent allowances and subscriptions, settled in tUSD8.
/// @dev Non-custodial and immutable: no owner, no admin, no upgrade path. Money moves from the payer's
///      wallet to the payee's in the same transaction; this contract never keeps a balance.
///
///      Ways money moves:
///        1. `payUsername` / `payProduct`: the payer approved this contract and calls it.
///        2. `*WithAuthorization`: the payer signs an EIP-3009 `ReceiveWithAuthorization`; anyone may
///           submit it. The signed nonce must equal `paymentNonce(payee, productId, memo, salt)`, so
///           the signature itself fixes who gets paid. A relayer can't redirect it.
///        3. `agentPay`: an agent key, signing with its own key, spends from an owner's wallet within an
///           allowance the owner granted on-chain (budget, per-payment cap, expiry, optional payee list).
///        4. `collect`: anyone may trigger a due subscription charge. Terms are fixed at subscribe time;
///           at most one charge per period, never back-charged for missed periods.
///
///      Fees: person-to-person payments are free. Store purchases and subscription charges pay a fixed
///      FEE_BPS (0.5%) to an immutable treasury, recorded on every receipt.
contract AevumPay is EIP712 {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    /// @notice Receives merchant fees. Fixed at deploy.
    address public immutable treasury;

    uint256 public constant FEE_BPS = 50; // 0.5% on store purchases and subscription charges
    uint256 public constant MIN_USERNAME_LEN = 3;
    uint256 public constant MAX_USERNAME_LEN = 24;
    /// @notice Shortest subscription period. Short so a testnet demo can show renewals live.
    uint64 public constant MIN_PERIOD = 60;
    /// @notice How long a failed subscription charge may be retried before it lapses (capped at one period).
    uint64 public constant GRACE_PERIOD = 3 days;
    uint256 public constant MAX_AGENT_PAYEES = 20;

    bytes32 private constant PAYMENT_NONCE_TAG = keccak256("AevumPay.payment.v2");
    bytes32 public constant AGENT_PAYMENT_TYPEHASH = keccak256(
        "AgentPayment(address payee,uint256 productId,uint256 amount,bytes32 memo,bytes32 nonce,uint256 deadline)"
    );

    // ---------- usernames ----------
    mapping(bytes32 usernameHash => address wallet) private _walletOf;
    mapping(address wallet => string username) public usernameOf;

    // ---------- stores / products ----------
    struct Store {
        string name;
        bool active;
    }

    mapping(address merchant => Store) public storeOf;

    struct Product {
        address merchant;
        string name;
        uint256 price;
        bool active;
    }

    mapping(uint256 productId => Product) public products;
    uint256 public nextProductId = 1;

    // ---------- payments ----------
    struct Receipt {
        address payer;
        address payee;
        uint256 amount; // what the payer paid; the payee got amount - fee
        uint256 productId; // 0 for person-to-person
        uint64 paidAt;
        bytes32 memo;
        uint256 fee;
        address via; // the agent key that signed, or address(0) if the payer did
        uint256 subscriptionId; // 0 unless this was a subscription charge
    }

    mapping(uint256 paymentId => Receipt) public receiptOf;
    uint256 public nextPaymentId = 1;

    /// @dev One payment being settled (kept in a struct to stay under the EVM stack limit).
    struct Settlement {
        address payer;
        address payee;
        uint256 productId;
        uint256 amount;
        bytes32 memo;
        address via;
        uint256 subscriptionId;
    }

    // ---------- agent allowances ----------
    struct Allowance {
        address owner;
        uint64 expiresAt;
        bool active;
        bool payeesRestricted;
        uint32 grantId;
        uint128 budget;
        uint128 spent;
        uint128 maxPerPayment;
    }

    mapping(address agent => Allowance) private _allowances;
    mapping(bytes32 key => bool allowed) private _agentPayees; // keccak(agent, grantId, payee)
    mapping(address agent => mapping(bytes32 nonce => bool used)) public agentNonceUsed;

    /// @notice What an agent signs (EIP-712, domain "AevumPay" v2) to spend from its owner's wallet.
    struct AgentPayment {
        address payee; // resolved wallet; for a product, the merchant
        uint256 productId; // 0 for a username payment
        uint256 amount;
        bytes32 memo;
        bytes32 nonce;
        uint256 deadline;
    }

    // ---------- subscriptions ----------
    struct Plan {
        address merchant;
        uint128 amount;
        uint64 period;
        bool active;
        string name;
    }

    mapping(uint256 planId => Plan) private _plans;
    uint256 public nextPlanId = 1;

    enum SubStatus {
        None,
        Active,
        Cancelled,
        Lapsed,
        Completed
    }

    /// @dev Terms are copied from the plan at subscribe time and never change afterwards.
    struct Subscription {
        address subscriber;
        address merchant;
        uint128 amount;
        uint64 period;
        uint64 nextDue;
        uint64 pastDueSince; // 0 when current
        uint32 paidCount;
        uint32 maxPayments; // 0 = until cancelled
        SubStatus status;
        uint256 planId;
    }

    mapping(uint256 subscriptionId => Subscription) private _subscriptions;
    uint256 public nextSubscriptionId = 1;

    // ---------- events ----------
    event Registered(string username, address indexed wallet);
    event UsernameChanged(string oldUsername, string newUsername, address indexed wallet);
    event StoreCreated(address indexed merchant, string name);
    event StoreUpdated(address indexed merchant, string name, bool active);
    event ProductAdded(uint256 indexed productId, address indexed merchant, string name, uint256 price);
    event ProductUpdated(uint256 indexed productId, bool active);
    event Paid(
        uint256 indexed paymentId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint256 productId,
        bytes32 memo,
        uint256 fee
    );
    event AllowanceGranted(
        address indexed owner,
        address indexed agent,
        uint256 budget,
        uint256 maxPerPayment,
        uint64 expiresAt,
        uint32 grantId
    );
    event AllowanceRevoked(address indexed owner, address indexed agent);
    event AgentPaid(uint256 indexed paymentId, address indexed agent, address indexed owner);
    event PlanCreated(uint256 indexed planId, address indexed merchant, string name, uint256 amount, uint64 period);
    event PlanUpdated(uint256 indexed planId, bool active);
    event Subscribed(uint256 indexed subscriptionId, uint256 indexed planId, address indexed subscriber);
    event SubscriptionCharged(uint256 indexed subscriptionId, uint256 indexed paymentId, uint64 nextDue);
    event CollectionFailed(uint256 indexed subscriptionId, uint64 dueAt);
    event SubscriptionEnded(uint256 indexed subscriptionId, SubStatus status);

    // ---------- errors ----------
    error ZeroAddress();
    error ZeroAmount();
    error UsernameTooShort();
    error UsernameTooLong();
    error UsernameTaken();
    error AlreadyRegistered();
    error NotRegistered();
    error UnknownUser();
    error SelfPayment();
    error StoreExists();
    error NoStore();
    error StoreInactive();
    error NotStoreOwner();
    error ProductNotFound();
    error ProductInactive();
    error BadAgent();
    error AgentInUse();
    error BadAllowance();
    error NotAllowanceOwner();
    error AllowanceInactive();
    error AllowanceExpired();
    error OverPerPaymentLimit();
    error OverBudget();
    error PayeeNotAllowed();
    error BadSignature();
    error SignatureExpired();
    error NonceUsed();
    error WrongAmount();
    error PlanNotFound();
    error PlanInactive();
    error PeriodTooShort();
    error NotSubscriptionParty();
    error SubscriptionNotActive();
    error NotDue();

    constructor(IERC20 token_, address treasury_) EIP712("AevumPay", "2") {
        if (address(token_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        token = token_;
        treasury = treasury_;
    }

    // =====================================================================
    //  Usernames
    // =====================================================================

    /// @notice Claim `username` for `msg.sender`. One claim per wallet; use `changeUsername` to move.
    function register(string calldata username) external {
        if (bytes(usernameOf[msg.sender]).length != 0) revert AlreadyRegistered();
        _claim(username, msg.sender);
    }

    /// @notice Change the caller's username. Frees the old one.
    function changeUsername(string calldata newUsername) external {
        string memory old = usernameOf[msg.sender];
        if (bytes(old).length == 0) revert NotRegistered();
        bytes32 newHash = _hashUsername(newUsername);
        if (_walletOf[newHash] == msg.sender) revert UsernameTaken(); // same name
        _validateUsername(newUsername);
        if (_walletOf[newHash] != address(0)) revert UsernameTaken();
        delete _walletOf[_hashUsername(old)];
        _walletOf[newHash] = msg.sender;
        usernameOf[msg.sender] = newUsername;
        emit UsernameChanged(old, newUsername, msg.sender);
    }

    /// @notice Resolve a username to its wallet. Returns address(0) if unclaimed.
    function resolve(string calldata username) external view returns (address) {
        return _walletOf[_hashUsername(username)];
    }

    function isUsernameTaken(string calldata username) external view returns (bool) {
        return _walletOf[_hashUsername(username)] != address(0);
    }

    function walletOf(string calldata username) external view returns (address) {
        return _walletOf[_hashUsername(username)];
    }

    // =====================================================================
    //  Stores / products
    // =====================================================================

    /// @notice Create the caller's store. One store per wallet.
    function createStore(string calldata name) external {
        Store storage s = storeOf[msg.sender];
        if (bytes(s.name).length != 0) revert StoreExists();
        if (bytes(name).length == 0) revert ZeroAmount();
        s.name = name;
        s.active = true;
        emit StoreCreated(msg.sender, name);
    }

    function renameStore(string calldata name) external {
        Store storage s = storeOf[msg.sender];
        if (bytes(s.name).length == 0) revert NoStore();
        if (bytes(name).length == 0) revert ZeroAmount();
        s.name = name;
        emit StoreUpdated(msg.sender, name, s.active);
    }

    function setStoreActive(bool active) external {
        Store storage s = storeOf[msg.sender];
        if (bytes(s.name).length == 0) revert NoStore();
        s.active = active;
        emit StoreUpdated(msg.sender, s.name, active);
    }

    /// @notice Add a product to the caller's store. `price` is in token base units (6dp).
    function addProduct(string calldata name, uint256 price) external returns (uint256 productId) {
        _requireOpenStore(msg.sender);
        if (price == 0) revert ZeroAmount();
        if (bytes(name).length == 0) revert ZeroAmount();
        productId = nextProductId++;
        products[productId] = Product({merchant: msg.sender, name: name, price: price, active: true});
        emit ProductAdded(productId, msg.sender, name, price);
    }

    function setProductActive(uint256 productId, bool active) external {
        Product storage p = products[productId];
        if (p.merchant == address(0)) revert ProductNotFound();
        if (p.merchant != msg.sender) revert NotStoreOwner();
        p.active = active;
        emit ProductUpdated(productId, active);
    }

    // ---------- struct getters (public mappings expose tuples; these return structs) ----------

    function getStore(address merchant) external view returns (Store memory) {
        return storeOf[merchant];
    }

    function getProduct(uint256 productId) external view returns (Product memory) {
        return products[productId];
    }

    function getReceipt(uint256 paymentId) external view returns (Receipt memory) {
        return receiptOf[paymentId];
    }

    /// @notice The fee on a store purchase or subscription charge of `amount`.
    function feeFor(uint256 amount) public pure returns (uint256) {
        return (amount * FEE_BPS) / 10_000;
    }

    // =====================================================================
    //  Payments: approve + pay
    // =====================================================================

    /// @notice Pay a user by username. Free. Caller must have approved this contract first.
    function payUsername(string calldata username, uint256 amount, bytes32 memo)
        external
        returns (uint256 paymentId)
    {
        address payee = _requireUser(username);
        if (payee == msg.sender) revert SelfPayment();
        if (amount == 0) revert ZeroAmount();
        paymentId = _settleFrom(Settlement(msg.sender, payee, 0, amount, memo, address(0), 0), false);
    }

    /// @notice Buy a product: its price goes to the merchant, minus the fee. Caller must have approved.
    function payProduct(uint256 productId, bytes32 memo) external returns (uint256 paymentId) {
        Product memory p = _requireActiveProduct(productId);
        if (p.merchant == msg.sender) revert SelfPayment();
        paymentId = _settleFrom(Settlement(msg.sender, p.merchant, productId, p.price, memo, address(0), 0), true);
    }

    // =====================================================================
    //  Payments: EIP-3009 gasless (payer signs, anyone submits)
    // =====================================================================

    /// @notice The EIP-3009 nonce a payer must sign for a payment to `payee`. Binding the payee,
    ///         product and memo into the signed nonce means whoever submits it can't change them.
    function paymentNonce(address payee, uint256 productId, bytes32 memo, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(PAYMENT_NONCE_TAG, payee, productId, memo, salt));
    }

    /// @notice A payer's EIP-3009 `ReceiveWithAuthorization` signature. The signed nonce must be
    ///         `paymentNonce(payee, productId, memo, salt)`; only the salt travels here.
    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Pay a user by username, gaslessly. Sign `to = this contract`, `value = amount` and
    ///         `nonce = paymentNonce(resolve(username), 0, memo, salt)`.
    function payUsernameWithAuthorization(
        string calldata username,
        uint256 amount,
        bytes32 memo,
        Authorization calldata auth
    ) external returns (uint256 paymentId) {
        address payee = _requireUser(username);
        if (payee == auth.from) revert SelfPayment();
        if (amount == 0) revert ZeroAmount();
        _receive(auth, amount, paymentNonce(payee, 0, memo, auth.salt));
        paymentId = _settleHeld(Settlement(auth.from, payee, 0, amount, memo, address(0), 0), false);
    }

    /// @notice Buy a product, gaslessly. Sign `value = price`, `to = this contract` and
    ///         `nonce = paymentNonce(merchant, productId, memo, salt)`.
    function payProductWithAuthorization(uint256 productId, bytes32 memo, Authorization calldata auth)
        external
        returns (uint256 paymentId)
    {
        Product memory p = _requireActiveProduct(productId);
        if (p.merchant == auth.from) revert SelfPayment();
        _receive(auth, p.price, paymentNonce(p.merchant, productId, memo, auth.salt));
        paymentId = _settleHeld(Settlement(auth.from, p.merchant, productId, p.price, memo, address(0), 0), true);
    }

    /// @dev Pull `amount` from the payer into this contract; it is forwarded in the same transaction.
    function _receive(Authorization calldata a, uint256 amount, bytes32 nonce) private {
        IERC3009(address(token)).receiveWithAuthorization(
            a.from, address(this), amount, a.validAfter, a.validBefore, nonce, a.v, a.r, a.s
        );
    }

    // =====================================================================
    //  Agent allowances
    // =====================================================================

    /// @notice Let `agent` (a separate key: an AI agent, a script, a bot) spend from the caller's
    ///         wallet: up to `budget` in total, at most `maxPerPayment` each time, until `expiresAt`,
    ///         and only to `payees` if any are given. Replaces the caller's earlier grant to this agent.
    ///         The caller must also approve this contract on the token for at least `budget`.
    function grantAllowance(
        address agent,
        uint128 budget,
        uint128 maxPerPayment,
        uint64 expiresAt,
        address[] calldata payees
    ) external {
        if (agent == address(0) || agent == msg.sender) revert BadAgent();
        if (budget == 0 || maxPerPayment == 0 || maxPerPayment > budget) revert BadAllowance();
        if (expiresAt <= block.timestamp || payees.length > MAX_AGENT_PAYEES) revert BadAllowance();
        Allowance storage a = _allowances[agent];
        // One owner per agent key: another wallet can't take over a live grant.
        if (a.active && a.owner != msg.sender && a.expiresAt > block.timestamp) revert AgentInUse();

        uint32 grantId = a.grantId + 1;
        _allowances[agent] = Allowance({
            owner: msg.sender,
            expiresAt: expiresAt,
            active: true,
            payeesRestricted: payees.length > 0,
            grantId: grantId,
            budget: budget,
            spent: 0,
            maxPerPayment: maxPerPayment
        });
        for (uint256 i; i < payees.length; ++i) {
            _agentPayees[keccak256(abi.encode(agent, grantId, payees[i]))] = true;
        }
        emit AllowanceGranted(msg.sender, agent, budget, maxPerPayment, expiresAt, grantId);
    }

    /// @notice Stop `agent` from spending, immediately.
    function revokeAllowance(address agent) external {
        Allowance storage a = _allowances[agent];
        if (a.owner != msg.sender) revert NotAllowanceOwner();
        if (!a.active) revert AllowanceInactive();
        a.active = false;
        emit AllowanceRevoked(msg.sender, agent);
    }

    function getAllowance(address agent) external view returns (Allowance memory) {
        return _allowances[agent];
    }

    function isAgentPayee(address agent, address payee) external view returns (bool) {
        Allowance storage a = _allowances[agent];
        return !a.payeesRestricted || _agentPayees[keccak256(abi.encode(agent, a.grantId, payee))];
    }

    /// @notice The EIP-712 digest an agent signs for `p`.
    function agentPaymentDigest(AgentPayment calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(AGENT_PAYMENT_TYPEHASH, p.payee, p.productId, p.amount, p.memo, p.nonce, p.deadline)
            )
        );
    }

    /// @notice Pay on behalf of an allowance owner. Anyone may submit; the agent's signature and the
    ///         on-chain limits decide. For a product, `amount` must equal its price and the fee applies.
    function agentPay(AgentPayment calldata p, bytes calldata signature) external returns (uint256 paymentId) {
        if (block.timestamp > p.deadline) revert SignatureExpired();
        address agent = ECDSA.recover(agentPaymentDigest(p), signature);
        if (agentNonceUsed[agent][p.nonce]) revert NonceUsed();

        Allowance storage a = _allowances[agent];
        if (a.owner == address(0)) revert BadSignature(); // not a known agent
        if (!a.active) revert AllowanceInactive();
        if (block.timestamp >= a.expiresAt) revert AllowanceExpired();
        if (p.amount == 0) revert ZeroAmount();
        if (p.amount > a.maxPerPayment) revert OverPerPaymentLimit();
        if (a.spent + p.amount > a.budget) revert OverBudget();
        if (a.payeesRestricted && !_agentPayees[keccak256(abi.encode(agent, a.grantId, p.payee))]) {
            revert PayeeNotAllowed();
        }
        if (p.payee == a.owner) revert SelfPayment();

        bool isProduct = p.productId != 0;
        if (isProduct) {
            Product memory prod = _requireActiveProduct(p.productId);
            if (prod.merchant != p.payee) revert PayeeNotAllowed();
            if (prod.price != p.amount) revert WrongAmount();
        } else if (bytes(usernameOf[p.payee]).length == 0) {
            revert UnknownUser(); // agents pay registered @usernames or stores only
        }

        agentNonceUsed[agent][p.nonce] = true;
        a.spent += uint128(p.amount);
        paymentId = _settleFrom(Settlement(a.owner, p.payee, p.productId, p.amount, p.memo, agent, 0), isProduct);
        emit AgentPaid(paymentId, agent, a.owner);
    }

    // =====================================================================
    //  Subscriptions
    // =====================================================================

    /// @notice Offer a subscription: `amount` every `period` seconds.
    function createPlan(string calldata name, uint128 amount, uint64 period) external returns (uint256 planId) {
        _requireOpenStore(msg.sender);
        if (amount == 0 || bytes(name).length == 0) revert ZeroAmount();
        if (period < MIN_PERIOD) revert PeriodTooShort();
        planId = nextPlanId++;
        _plans[planId] = Plan({merchant: msg.sender, amount: amount, period: period, active: true, name: name});
        emit PlanCreated(planId, msg.sender, name, amount, period);
    }

    /// @notice Stop or resume new sign-ups. Existing subscribers keep their terms either way.
    function setPlanActive(uint256 planId, bool active) external {
        Plan storage pl = _plans[planId];
        if (pl.merchant == address(0)) revert PlanNotFound();
        if (pl.merchant != msg.sender) revert NotStoreOwner();
        pl.active = active;
        emit PlanUpdated(planId, active);
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return _plans[planId];
    }

    function getSubscription(uint256 subscriptionId) external view returns (Subscription memory) {
        return _subscriptions[subscriptionId];
    }

    /// @notice Subscribe to `planId` and pay the first period now. `maxPayments` = 0 means until
    ///         cancelled. The caller must have approved this contract on the token.
    function subscribe(uint256 planId, uint32 maxPayments) external returns (uint256 subscriptionId) {
        Plan memory pl = _plans[planId];
        if (pl.merchant == address(0)) revert PlanNotFound();
        if (!pl.active) revert PlanInactive();
        if (pl.merchant == msg.sender) revert SelfPayment();

        subscriptionId = nextSubscriptionId++;
        _subscriptions[subscriptionId] = Subscription({
            subscriber: msg.sender,
            merchant: pl.merchant,
            amount: pl.amount,
            period: pl.period,
            nextDue: uint64(block.timestamp) + pl.period,
            pastDueSince: 0,
            paidCount: 1,
            maxPayments: maxPayments,
            status: SubStatus.Active,
            planId: planId
        });
        emit Subscribed(subscriptionId, planId, msg.sender);

        uint256 paymentId = _settleFrom(
            Settlement(msg.sender, pl.merchant, 0, pl.amount, bytes32(planId), address(0), subscriptionId), true
        );
        emit SubscriptionCharged(subscriptionId, paymentId, uint64(block.timestamp) + pl.period);
        if (maxPayments == 1) _end(subscriptionId, SubStatus.Completed);
    }

    /// @notice End a subscription. Either the subscriber or the merchant may cancel. No further charges.
    function cancelSubscription(uint256 subscriptionId) external {
        Subscription storage s = _subscriptions[subscriptionId];
        if (msg.sender != s.subscriber && msg.sender != s.merchant) revert NotSubscriptionParty();
        if (s.status != SubStatus.Active) revert SubscriptionNotActive();
        _end(subscriptionId, SubStatus.Cancelled);
    }

    /// @notice Charge a due subscription. Anyone may call: the terms decide the amount, the payee and
    ///         the timing. If the subscriber can't cover it, nothing moves; it's retried until the grace
    ///         period ends, then the subscription lapses. Missed periods are never charged later.
    /// @return charged Whether money moved.
    function collect(uint256 subscriptionId) external returns (bool charged) {
        Subscription storage s = _subscriptions[subscriptionId];
        if (s.status != SubStatus.Active) revert SubscriptionNotActive();
        if (block.timestamp < s.nextDue) revert NotDue();

        uint256 amount = s.amount;
        bool covered = token.balanceOf(s.subscriber) >= amount
            && token.allowance(s.subscriber, address(this)) >= amount;

        if (!covered) {
            if (s.pastDueSince == 0) s.pastDueSince = uint64(block.timestamp);
            uint64 grace = s.period < GRACE_PERIOD ? s.period : GRACE_PERIOD;
            if (block.timestamp >= uint256(s.nextDue) + grace) {
                _end(subscriptionId, SubStatus.Lapsed);
            } else {
                emit CollectionFailed(subscriptionId, s.nextDue);
            }
            return false;
        }

        // Next due date: one period after this one, skipping any periods missed entirely.
        uint64 next = s.nextDue + s.period;
        if (next <= block.timestamp) {
            uint64 missed = (uint64(block.timestamp) - next) / s.period + 1;
            next += missed * s.period;
        }
        s.nextDue = next;
        s.pastDueSince = 0;
        s.paidCount += 1;

        uint256 paymentId = _settleFrom(
            Settlement(s.subscriber, s.merchant, 0, amount, bytes32(s.planId), address(0), subscriptionId), true
        );
        emit SubscriptionCharged(subscriptionId, paymentId, next);
        if (s.maxPayments != 0 && s.paidCount >= s.maxPayments) _end(subscriptionId, SubStatus.Completed);
        return true;
    }

    // =====================================================================
    //  Internal
    // =====================================================================

    function _claim(string calldata username, address wallet) private {
        _validateUsername(username);
        bytes32 h = _hashUsername(username);
        if (_walletOf[h] != address(0)) revert UsernameTaken();
        _walletOf[h] = wallet;
        usernameOf[wallet] = username;
        emit Registered(username, wallet);
    }

    function _validateUsername(string calldata username) private pure {
        uint256 n = bytes(username).length;
        if (n < MIN_USERNAME_LEN) revert UsernameTooShort();
        if (n > MAX_USERNAME_LEN) revert UsernameTooLong();
    }

    function _requireUser(string calldata username) private view returns (address wallet) {
        wallet = _walletOf[_hashUsername(username)];
        if (wallet == address(0)) revert UnknownUser();
    }

    function _requireOpenStore(address merchant) private view {
        Store storage s = storeOf[merchant];
        if (bytes(s.name).length == 0) revert NoStore();
        if (!s.active) revert StoreInactive();
    }

    function _requireActiveProduct(uint256 productId) private view returns (Product memory p) {
        p = products[productId];
        if (p.merchant == address(0)) revert ProductNotFound();
        if (!p.active) revert ProductInactive();
    }

    function _end(uint256 subscriptionId, SubStatus status) private {
        _subscriptions[subscriptionId].status = status;
        emit SubscriptionEnded(subscriptionId, status);
    }

    /// @dev Pull from the payer (who approved this contract) straight to the payee and the treasury.
    function _settleFrom(Settlement memory st, bool withFee) private returns (uint256 paymentId) {
        uint256 fee = withFee ? feeFor(st.amount) : 0;
        token.safeTransferFrom(st.payer, st.payee, st.amount - fee);
        if (fee != 0) token.safeTransferFrom(st.payer, treasury, fee);
        paymentId = _record(st, fee);
    }

    /// @dev Forward funds this contract just received (EIP-3009) in the same transaction.
    function _settleHeld(Settlement memory st, bool withFee) private returns (uint256 paymentId) {
        uint256 fee = withFee ? feeFor(st.amount) : 0;
        token.safeTransfer(st.payee, st.amount - fee);
        if (fee != 0) token.safeTransfer(treasury, fee);
        paymentId = _record(st, fee);
    }

    function _record(Settlement memory st, uint256 fee) private returns (uint256 paymentId) {
        paymentId = nextPaymentId++;
        receiptOf[paymentId] = Receipt({
            payer: st.payer,
            payee: st.payee,
            amount: st.amount,
            productId: st.productId,
            paidAt: uint64(block.timestamp),
            memo: st.memo,
            fee: fee,
            via: st.via,
            subscriptionId: st.subscriptionId
        });
        emit Paid(paymentId, st.payer, st.payee, st.amount, st.productId, st.memo, fee);
    }

    function _hashUsername(string memory username) private pure returns (bytes32) {
        return keccak256(bytes(username));
    }
}
