/**
 * Memos go on-chain only as a keccak hash, so the text itself can't be read back from the chain.
 * Right after a payment we keep its details in this browser so the receipt can show the note and
 * tx straight away; other receipts fall back to what the chain and /activity provide.
 */
export interface LocalReceipt {
  note?: string;
  product?: string;
  txHash: string;
  explorer: string;
  blockNumber?: number;
  counterparty?: string;
}

const key = (id: string) => `aevumpay.receipt.${id}`;

export function saveLocalReceipt(id: string, r: LocalReceipt): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(r));
  } catch {
    /* storage blocked: the receipt still loads from the chain */
  }
}

export function loadLocalReceipt(id: string): LocalReceipt | null {
  try {
    const v = localStorage.getItem(key(id));
    return v ? (JSON.parse(v) as LocalReceipt) : null;
  } catch {
    return null;
  }
}
