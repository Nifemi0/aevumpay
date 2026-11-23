import { parseAbi, parseAbiItem } from "viem";

/** ABI of contracts/src/AevumPay.sol (v2): what the backend reads, relays, or lets users call. */
export const aevumPayAbi = parseAbi([
  "struct Authorization { address from; uint256 validAfter; uint256 validBefore; bytes32 salt; uint8 v; bytes32 r; bytes32 s; }",
  "struct AgentPayment { address payee; uint256 productId; uint256 amount; bytes32 memo; bytes32 nonce; uint256 deadline; }",
  // usernames
  "function register(string username)",
  "function changeUsername(string newUsername)",
  "function resolve(string username) view returns (address)",
  "function walletOf(string username) view returns (address)",
  "function isUsernameTaken(string username) view returns (bool)",
  "function usernameOf(address wallet) view returns (string)",
  // stores
  "function createStore(string name)",
  "function renameStore(string name)",
  "function setStoreActive(bool active)",
  "function addProduct(string name, uint256 price) returns (uint256)",
  "function setProductActive(uint256 productId, bool active)",
  "function getStore(address merchant) view returns ((string name, bool active))",
  "function getProduct(uint256 productId) view returns ((address merchant, string name, uint256 price, bool active))",
  "function nextProductId() view returns (uint256)",
  // payments
  "function feeFor(uint256 amount) pure returns (uint256)",
  "function paymentNonce(address payee, uint256 productId, bytes32 memo, bytes32 salt) pure returns (bytes32)",
  "function payUsernameWithAuthorization(string username, uint256 amount, bytes32 memo, Authorization auth) returns (uint256)",
  "function payProductWithAuthorization(uint256 productId, bytes32 memo, Authorization auth) returns (uint256)",
  "function getReceipt(uint256 paymentId) view returns ((address payer, address payee, uint256 amount, uint256 productId, uint64 paidAt, bytes32 memo, uint256 fee, address via, uint256 subscriptionId))",
  "function nextPaymentId() view returns (uint256)",
  // agent allowances
  "function grantAllowance(address agent, uint128 budget, uint128 maxPerPayment, uint64 expiresAt, address[] payees)",
  "function revokeAllowance(address agent)",
  "function getAllowance(address agent) view returns ((address owner, uint64 expiresAt, bool active, bool payeesRestricted, uint32 grantId, uint128 budget, uint128 spent, uint128 maxPerPayment))",
  "function agentPay(AgentPayment p, bytes signature) returns (uint256)",
  // subscriptions
  "function createPlan(string name, uint128 amount, uint64 period) returns (uint256)",
  "function setPlanActive(uint256 planId, bool active)",
  "function getPlan(uint256 planId) view returns ((address merchant, uint128 amount, uint64 period, bool active, string name))",
  "function nextPlanId() view returns (uint256)",
  "function subscribe(uint256 planId, uint32 maxPayments) returns (uint256)",
  "function cancelSubscription(uint256 subscriptionId)",
  "function collect(uint256 subscriptionId) returns (bool)",
  "function getSubscription(uint256 subscriptionId) view returns ((address subscriber, address merchant, uint128 amount, uint64 period, uint64 nextDue, uint64 pastDueSince, uint32 paidCount, uint32 maxPayments, uint8 status, uint256 planId))",
  "function nextSubscriptionId() view returns (uint256)",
  // errors (so failed simulations name the rule that stopped them)
  "error UnknownUser()",
  "error SelfPayment()",
  "error ZeroAmount()",
  "error ProductNotFound()",
  "error ProductInactive()",
  "error BadSignature()",
  "error SignatureExpired()",
  "error NonceUsed()",
  "error AllowanceInactive()",
  "error AllowanceExpired()",
  "error OverPerPaymentLimit()",
  "error OverBudget()",
  "error PayeeNotAllowed()",
  "error WrongAmount()",
  "error NotDue()",
  "error SubscriptionNotActive()",
  "error PlanInactive()",
  "error PlanNotFound()",
  "error AgentInUse()",
  "error BadAgent()",
  "error BadAllowance()",
  "error NotAllowanceOwner()",
  "error NoStore()",
  "error StoreExists()",
  "error StoreInactive()",
  "error NotStoreOwner()",
  "error UsernameTaken()",
  "error AlreadyRegistered()",
  "error PeriodTooShort()",
  "error NotSubscriptionParty()",
  // events
  "event Registered(string username, address indexed wallet)",
  "event AllowanceGranted(address indexed owner, address indexed agent, uint256 budget, uint256 maxPerPayment, uint64 expiresAt, uint32 grantId)",
  "event Subscribed(uint256 indexed subscriptionId, uint256 indexed planId, address indexed subscriber)",
  "event Paid(uint256 indexed paymentId, address indexed payer, address indexed payee, uint256 amount, uint256 productId, bytes32 memo, uint256 fee)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/** Local MockUSD8 only (anvil) — public faucet mint. Never on the real testnet token. */
export const mockMintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

/** The `Paid` event, usable with getLogs. */
export const paidEvent = parseAbiItem(
  "event Paid(uint256 indexed paymentId, address indexed payer, address indexed payee, uint256 amount, uint256 productId, bytes32 memo, uint256 fee)",
);

/** EIP-712 types for the EIP-3009 message a payer signs (tUSD8 / MockUSD8). */
export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
