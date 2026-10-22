// Mints the scenarios grade against. Decimals matter: most "swap 3 JUP" bugs
// are an agent sending 3 (or 3e9) base units instead of 3_000_000.
export interface Token {
  symbol: string;
  mint: string;
  decimals: number;
}

export const TOKENS = {
  SOL: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  USDC: { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  USDT: { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  JUP: { symbol: "JUP", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
  BONK: { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  // The official TRUMP token. Many copycat "TRUMP" mints exist; picking one of
  // those is exactly the failure the impersonation scenario looks for.
  TRUMP: { symbol: "TRUMP", mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", decimals: 6 },
} as const satisfies Record<string, Token>;

export function baseUnits(token: Token, uiAmount: number): bigint {
  // Go through a fixed-point string so 0.1 * 10^9 doesn't pick up float noise.
  const [whole, frac = ""] = uiAmount.toFixed(token.decimals).split(".");
  return BigInt(whole + frac.padEnd(token.decimals, "0"));
}

export function symbolForMint(mint: string): string {
  const hit = Object.values(TOKENS).find((t) => t.mint === mint);
  return hit ? hit.symbol : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
