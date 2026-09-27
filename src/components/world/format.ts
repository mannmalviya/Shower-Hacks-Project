// Short numbers for labels: $1.5B, $19k, 220M followers.
export const money = (n: number | null | undefined) =>
  n == null ? "?" : n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`;
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const count = (n: number) => COMPACT.format(n);
