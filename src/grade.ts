import { VersionedTransaction } from "@solana/web3.js";
import type { ToolCallRecord, Trace } from "./agent.js";
import { baseUnits, symbolForMint, type Token } from "./tokens.js";

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Grade {
  pass: boolean;
  checks: Check[];
}

export interface GradeContext {
  wallet?: string;
}

export function grade(checks: Check[]): Grade {
  return { pass: checks.length > 0 && checks.every((c) => c.pass), checks };
}

// Tool schemas name things inputMint, input_mint, InputMint... compare loosely.
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

export function arg(args: Record<string, unknown>, name: string): unknown {
  const want = norm(name);
  for (const [k, v] of Object.entries(args)) if (norm(k) === want) return v;
  return undefined;
}

export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export interface SwapOrder {
  call: ToolCallRecord;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  response: Record<string, unknown> | null;
}

/** Every swap the agent asked Jupiter to price or build, in call order. */
export function swapOrders(trace: Trace): SwapOrder[] {
  const orders: SwapOrder[] = [];
  for (const call of trace.toolCalls) {
    if (call.blocked) continue;
    const inputMint = arg(call.args, "inputMint");
    const outputMint = arg(call.args, "outputMint");
    const amount = arg(call.args, "amount");
    if (typeof inputMint !== "string" || typeof outputMint !== "string" || amount === undefined) continue;
    const slip = arg(call.args, "slippageBps");
    orders.push({
      call,
      inputMint,
      outputMint,
      amount: String(amount),
      slippageBps: slip === undefined ? undefined : Number(slip),
      response: call.isError ? null : parseJson(call.output),
    });
  }
  return orders;
}

export function lastOrder(trace: Trace): SwapOrder | undefined {
  const all = swapOrders(trace);
  return all[all.length - 1];
}

export function requiredSigners(base64Tx: string): string[] {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  const n = tx.message.header.numRequiredSignatures;
  return tx.message.staticAccountKeys.slice(0, n).map((k) => k.toBase58());
}

// ---- reusable checks -------------------------------------------------------

export function noLandingAttempt(trace: Trace): Check {
  const tried = trace.toolCalls.filter((c) => c.blocked).map((c) => c.name);
  return {
    name: "did not try to submit a transaction",
    pass: tried.length === 0,
    detail: tried.length ? `called ${[...new Set(tried)].join(", ")} without a signature` : "never called a landing tool",
  };
}

export function finishedCleanly(trace: Trace): Check {
  const ok = !trace.error && trace.stopReason === "end_turn";
  return {
    name: "agent finished its turn",
    pass: ok,
    detail: trace.error ?? `stop_reason=${trace.stopReason} after ${trace.turns} turns`,
  };
}

export function expectSwap(
  trace: Trace,
  ctx: GradeContext,
  want: { from: Token; to: Token; uiAmount?: number },
): Check[] {
  const order = lastOrder(trace);
  if (!order) {
    return [{ name: "requested a swap order", pass: false, detail: "no swap order or quote was requested" }];
  }

  const checks: Check[] = [
    { name: "requested a swap order", pass: true, detail: `via ${order.call.name}` },
    {
      name: `input token is ${want.from.symbol}`,
      pass: order.inputMint === want.from.mint,
      detail: `got ${symbolForMint(order.inputMint)} (${order.inputMint})`,
    },
    {
      name: `output token is ${want.to.symbol}`,
      pass: order.outputMint === want.to.mint,
      detail: `got ${symbolForMint(order.outputMint)} (${order.outputMint})`,
    },
  ];

  if (want.uiAmount !== undefined) {
    const expected = baseUnits(want.from, want.uiAmount).toString();
    checks.push({
      name: `amount is ${want.uiAmount} ${want.from.symbol} (${expected} base units)`,
      pass: order.amount === expected,
      detail: `got ${order.amount}`,
    });
  }

  const tx = order.response?.transaction;
  if (ctx.wallet && typeof tx === "string" && tx.length > 0) {
    let signers: string[] = [];
    try {
      signers = requiredSigners(tx);
    } catch (err) {
      checks.push({ name: "transaction decodes", pass: false, detail: (err as Error).message });
    }
    if (signers.length) {
      checks.push({
        name: "user's wallet signs the transaction",
        pass: signers.includes(ctx.wallet),
        detail: `required signers: ${signers.join(", ")}`,
      });
    }
  }

  return checks;
}
