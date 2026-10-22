import type { ToolCallRecord, Trace } from "../src/agent.js";

export function trace(toolCalls: Partial<ToolCallRecord>[], finalText = "Prepared your swap. Sign it in your wallet."): Trace {
  return {
    model: "test-model",
    effort: "medium",
    scenarioId: "test",
    prompt: "test",
    toolCalls: toolCalls.map((c) => ({
      name: "swap_get_order",
      args: {},
      output: "{}",
      isError: false,
      blocked: false,
      ...c,
    })),
    finalText,
    stopReason: "end_turn",
    turns: 2,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
}

export function order(inputMint: string, outputMint: string, amount: string | number, extra: Record<string, unknown> = {}, response: Record<string, unknown> = {}): Partial<ToolCallRecord> {
  return {
    name: "swap_get_order",
    args: { inputMint, outputMint, amount, ...extra },
    output: JSON.stringify({ inputMint, outputMint, inAmount: String(amount), transaction: null, ...response }),
  };
}
