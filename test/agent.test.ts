import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "../src/agent.js";
import { isLandingTool, type ToolDef, type ToolSource } from "../src/tools.js";

const defs: ToolDef[] = [
  { name: "swap_get_order", description: "", inputSchema: { type: "object", properties: { inputMint: {}, outputMint: {}, amount: {} } } },
  { name: "swap_execute_order", description: "", inputSchema: { type: "object", properties: { requestId: {} } } },
  { name: "transaction_send", description: "", inputSchema: { type: "object", properties: { signedTransaction: {} } } },
  { name: "price_get", description: "", inputSchema: { type: "object", properties: {} } },
];

test("landing tools are detected by name or signed-tx parameter", () => {
  assert.deepEqual(defs.filter(isLandingTool).map((t) => t.name), ["swap_execute_order", "transaction_send"]);
});

function fakeClient(responses: Partial<Anthropic.Message>[]): Anthropic {
  let i = 0;
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  return { messages: { create: async () => ({ usage, ...responses[i++] }) } } as unknown as Anthropic;
}

function fakeTools(): ToolSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listTools: async () => defs,
    callTool: async (name) => {
      calls.push(name);
      return { text: JSON.stringify({ ok: name }), isError: false };
    },
    close: async () => {},
  };
}

test("agent loop records calls in order and never runs landing tools", async () => {
  const tools = fakeTools();
  const client = fakeClient([
    {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "a", name: "price_get", input: {} } as Anthropic.ToolUseBlock,
        { type: "tool_use", id: "b", name: "swap_get_order", input: { inputMint: "x", outputMint: "y", amount: "1" } } as Anthropic.ToolUseBlock,
      ],
    },
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "c", name: "swap_execute_order", input: { requestId: "r" } } as Anthropic.ToolUseBlock],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Ready for you to sign." } as Anthropic.TextBlock] },
  ]);

  const t = await runAgent({ client, model: "m", effort: "medium", tools, toolDefs: defs, scenarioId: "s", prompt: "p" });

  assert.deepEqual(t.toolCalls.map((c) => c.name), ["price_get", "swap_get_order", "swap_execute_order"]);
  assert.deepEqual(tools.calls, ["price_get", "swap_get_order"], "execute must never reach the MCP server");
  assert.equal(t.toolCalls[2].blocked, true);
  assert.equal(t.finalText, "Ready for you to sign.");
  assert.equal(t.stopReason, "end_turn");
  assert.equal(t.turns, 3);
  assert.equal(t.inputTokens, 30);
});

test("API errors end the run without throwing", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as unknown as Anthropic;
  const t = await runAgent({ client, model: "m", effort: "medium", tools: fakeTools(), toolDefs: defs, scenarioId: "s", prompt: "p" });
  assert.equal(t.error, "boom");
});
