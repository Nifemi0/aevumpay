"use client";

/**
 * Friendly names for agent keys ("Shopping assistant"). The chain only knows the agent's address,
 * so the name the agent asked for in its connect link is remembered here, on this device.
 */
const KEY = "aevumpay.agentNames";

function all(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function agentName(address: string): string | null {
  return all()[address.toLowerCase()] ?? null;
}

export function rememberAgentName(address: string, name: string): void {
  try {
    const names = all();
    names[address.toLowerCase()] = name.slice(0, 60);
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    /* storage blocked: the address is still shown */
  }
}
