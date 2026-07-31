export interface PurchaseXpFeedback {
  /** Compact syntax consumed by the world-space floating reward renderer. */
  floating: string;
  /** Human-readable syntax used when a purchase completes inside a modal. */
  toast: string;
}

/** Positive purchase XP gets feedback; zero-XP purchases stay quiet like harvests. */
export function purchaseXpFeedback(xp: number): PurchaseXpFeedback | null {
  const amount = Math.max(0, Math.trunc(xp));
  if (!amount) return null;
  return {
    floating: `+${amount}xp`,
    toast: `+${amount.toLocaleString("en-US")} XP`,
  };
}
