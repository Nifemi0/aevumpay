// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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

/// @title AevumPay
/// @notice Username payments + a minimal storefront, settled in tUSD8.
/// @dev Non-custodial: the contract never holds user funds. Every payment is forwarded
///      straight from the payer to the payee's wallet, and an on-chain `Paid` event is the
///      receipt. Usernames resolve to wallets on-chain so a payment to `alice` cannot be
///      redirected to a different address.
///
///      Two ways to pay:
///        1. `payUsername` / `payProduct`: the payer approves this contract, then calls it.
///        2. `*WithAuthorization`: the payer signs an EIP-3009 `ReceiveWithAuthorization`
///           off-chain; a backend/relayer submits it and pays the gas. The payer needs no
///           native gas. `to` in the signed message must be this contract.
contract AevumPay {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant MIN_USERNAME_LEN = 3;
    uint256 public constant MAX_USERNAME_LEN = 24;

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
        uint256 amount;
        uint256 productId; // 0 for person-to-person
        uint64 paidAt;
        bytes32 memo;
    }

    mapping(uint256 paymentId => Receipt) public receiptOf;
    uint256 public nextPaymentId = 1;

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
        bytes32 memo
    );

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

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
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
        s.name = name;
        s.active = true;
        emit StoreCreated(msg.sender, name);
    }

    function renameStore(string calldata name) external {
        Store storage s = storeOf[msg.sender];
        if (bytes(s.name).length == 0) revert NoStore();
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
        Store storage s = storeOf[msg.sender];
        if (bytes(s.name).length == 0) revert NoStore();
        if (!s.active) revert StoreInactive();
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

    // =====================================================================
    //  Payments — approve + pay
    // =====================================================================

    /// @notice Pay a user by username. Caller must have approved this contract first.
    function payUsername(string calldata username, uint256 amount, bytes32 memo)
        external
        returns (uint256 paymentId)
    {
        address payee = _requireUser(username);
        if (payee == msg.sender) revert SelfPayment();
        if (amount == 0) revert ZeroAmount();
        paymentId = _pay(msg.sender, payee, 0, amount, memo);
    }

    /// @notice Buy a product. Pays its price to the merchant. Caller must have approved this contract.
    function payProduct(uint256 productId, bytes32 memo) external returns (uint256 paymentId) {
        Product memory p = _requireActiveProduct(productId);
        if (p.merchant == msg.sender) revert SelfPayment();
        paymentId = _pay(msg.sender, p.merchant, productId, p.price, memo);
    }

    // =====================================================================
    //  Payments — EIP-3009 gasless (payer signs, anyone submits)
    // =====================================================================

    /// @notice Pay a user by username, gaslessly. `to` in the signature must be this contract.
    function payUsernameWithAuthorization(
        string calldata username,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes32 memo,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 paymentId) {
        address payee = _requireUser(username);
        if (payee == from) revert SelfPayment();
        if (amount == 0) revert ZeroAmount();
        paymentId = _payAuthorized(from, payee, 0, amount, validAfter, validBefore, nonce, memo, v, r, s);
    }

    /// @notice Buy a product, gaslessly. `to` in the signature must be this contract.
    function payProductWithAuthorization(
        uint256 productId,
        address from,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes32 memo,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 paymentId) {
        Product memory p = _requireActiveProduct(productId);
        if (p.merchant == from) revert SelfPayment();
        paymentId =
            _payAuthorized(from, p.merchant, productId, p.price, validAfter, validBefore, nonce, memo, v, r, s);
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

    function _requireActiveProduct(uint256 productId) private view returns (Product memory p) {
        p = products[productId];
        if (p.merchant == address(0)) revert ProductNotFound();
        if (!p.active) revert ProductInactive();
    }

    function _pay(address payer, address payee, uint256 productId, uint256 amount, bytes32 memo)
        private
        returns (uint256 paymentId)
    {
        token.safeTransferFrom(payer, payee, amount);
        paymentId = _record(payer, payee, productId, amount, memo);
    }

    function _payAuthorized(
        address from,
        address payee,
        uint256 productId,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes32 memo,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private returns (uint256 paymentId) {
        IERC3009(address(token)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        token.safeTransfer(payee, amount);
        paymentId = _record(from, payee, productId, amount, memo);
    }

    function _record(address payer, address payee, uint256 productId, uint256 amount, bytes32 memo)
        private
        returns (uint256 paymentId)
    {
        paymentId = nextPaymentId++;
        receiptOf[paymentId] =
            Receipt({payer: payer, payee: payee, amount: amount, productId: productId, paidAt: uint64(block.timestamp), memo: memo});
        emit Paid(paymentId, payer, payee, amount, productId, memo);
    }

    function _hashUsername(string memory username) private pure returns (bytes32) {
        return keccak256(bytes(username));
    }
}
