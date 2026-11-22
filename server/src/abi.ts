import { parseAbi } from "viem";

/** Minimal ABI of contracts/src/AevumPay.sol — only what the backend calls. */
export const aevumPayAbi = parseAbi([
  // usernames
  "function register(string username)",
  "function changeUsername(string newUsername)",
  "function resolve(string username) view returns (address)",
  "function walletOf(string username) view returns (address)",
  "function isUsernameTaken(string username) view returns (bool)",
  "function usernameOf(address wallet) view returns (string)",
  // stores
  "function createStore(string name)",
  "function addProduct(string name, uint256 price) returns (uint256)",
  "function setProductActive(uint256 productId, bool active)",
  "function getStore(address merchant) view returns ((string name, bool active))",
  "function getProduct(uint256 productId) view returns ((address merchant, string name, uint256 price, bool active))",
  "function nextProductId() view returns (uint256)",
  // payments
  "function payUsername(string username, uint256 amount, bytes32 memo) returns (uint256)",
  "function payProduct(uint256 productId, bytes32 memo) returns (uint256)",
  "function payUsernameWithAuthorization(string username, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes32 memo, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "function getReceipt(uint256 paymentId) view returns ((address payer, address payee, uint256 amount, uint256 productId, uint64 paidAt, bytes32 memo))",
  "function nextPaymentId() view returns (uint256)",
  // events
  "event Registered(string username, address indexed wallet)",
  "event Paid(uint256 indexed paymentId, address indexed payer, address indexed payee, uint256 amount, uint256 productId, bytes32 memo)",
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
