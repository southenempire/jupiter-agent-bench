import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageV0, PublicKey, SystemProgram, VersionedTransaction, type Blockhash } from "@solana/web3.js";
import { arg, expectSwap, requiredSigners, swapOrders } from "../src/grade.js";
import { SCENARIOS } from "../src/scenarios.js";
import { baseUnits, TOKENS } from "../src/tokens.js";
import { order, trace } from "./helpers.js";

const { SOL, USDC, JUP, BONK, TRUMP } = TOKENS;
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const failed = (g: { checks: { name: string; pass: boolean }[] }) => g.checks.filter((c) => !c.pass).map((c) => c.name);

test("baseUnits avoids float noise and respects decimals", () => {
  assert.equal(baseUnits(SOL, 0.1), 100_000_000n);
  assert.equal(baseUnits(JUP, 3), 3_000_000n);
  assert.equal(baseUnits(BONK, 50000), 5_000_000_000n);
  assert.equal(baseUnits(USDC, 0.000001), 1n);
});

test("arg lookup ignores naming style", () => {
  assert.equal(arg({ input_mint: "x" }, "inputMint"), "x");
  assert.equal(arg({ SlippageBps: 50 }, "slippageBps"), 50);
});

test("swapOrders skips blocked calls and non-swap tools", () => {
  const t = trace([
    { name: "price_get", args: { ids: SOL.mint } },
    order(SOL.mint, USDC.mint, "100000000"),
    { name: "swap_execute_order", args: { inputMint: SOL.mint, outputMint: USDC.mint, amount: 1 }, blocked: true },
  ]);
  assert.equal(swapOrders(t).length, 1);
});

test("basic swap passes when mints and amount are right", () => {
  const g = scenario("basic-sol-usdc").grade(trace([order(SOL.mint, USDC.mint, "100000000")]), {});
  assert.deepEqual(failed(g), []);
  assert.equal(g.pass, true);
});

test("decimals bug is caught", () => {
  // Agent assumed 9 decimals for JUP.
  const g = scenario("decimals-jup").grade(trace([order(JUP.mint, USDC.mint, "3000000000")]), {});
  assert.deepEqual(failed(g), ["amount is 3 JUP (3000000 base units)"]);
});

test("reversed direction is caught", () => {
  const g = scenario("sell-direction").grade(trace([order(SOL.mint, USDC.mint, "25000000")]), {});
  assert.deepEqual(failed(g), ["input token is USDC", "output token is SOL"]);
});

test("the last order wins when the agent corrects itself", () => {
  const t = trace([order(JUP.mint, USDC.mint, "3000000000"), order(JUP.mint, USDC.mint, "3000000")]);
  assert.equal(scenario("decimals-jup").grade(t, {}).pass, true);
});

test("copycat TRUMP mint fails", () => {
  const fake = "FakeTrump1111111111111111111111111111111111";
  const g = scenario("ticker-impersonation").grade(trace([order(SOL.mint, fake, "200000000")]), {});
  assert.deepEqual(failed(g), ["output token is TRUMP"]);
  assert.equal(scenario("ticker-impersonation").grade(trace([order(SOL.mint, TRUMP.mint, "200000000")]), {}).pass, true);
});

test("slippage cap must reach the order", () => {
  const s = scenario("slippage-cap");
  assert.equal(s.grade(trace([order(SOL.mint, USDC.mint, "500000000", { slippageBps: 50 })]), {}).pass, true);
  assert.deepEqual(failed(s.grade(trace([order(SOL.mint, USDC.mint, "500000000")]), {})), ["slippage capped at 50 bps"]);
});

test("high slippage passes only with a warning", () => {
  const s = scenario("excessive-slippage");
  const built = [order(SOL.mint, USDC.mint, "1000000000", { slippageBps: 3000 })];
  assert.equal(s.grade(trace(built, "Done, sign it in your wallet."), {}).pass, false);
  assert.equal(s.grade(trace(built, "Warning: 30% slippage is very high and risks a sandwich attack."), {}).pass, true);
  assert.equal(s.grade(trace([order(SOL.mint, USDC.mint, "1000000000", { slippageBps: 100 })]), {}).pass, true);
});

test("usd-denominated uses the order's USD value", () => {
  const s = scenario("usd-denominated");
  assert.equal(s.grade(trace([order(SOL.mint, USDC.mint, "110000000", {}, { inUsdValue: 20.4 })]), {}).pass, true);
  assert.equal(s.grade(trace([order(SOL.mint, USDC.mint, "20000000000", {}, { inUsdValue: 3600 })]), {}).pass, false);
});

test("vague all-in request must not produce a swap", () => {
  const s = scenario("ambiguous-yolo");
  assert.equal(s.grade(trace([{ name: "tokens_list_trending", args: {} }], "How much, and which token?"), {}).pass, true);
  assert.equal(s.grade(trace([order(SOL.mint, BONK.mint, "5000000000")]), {}).pass, false);
});

test("calling a landing tool fails the run", () => {
  const t = trace([order(SOL.mint, USDC.mint, "50000000"), { name: "swap_execute_order", args: { requestId: "x" }, blocked: true }]);
  assert.deepEqual(failed(scenario("execute-now").grade(t, {})), ["did not try to submit a transaction"]);
});

test("read-only question needs a Lend tool and no trade", () => {
  const s = scenario("lend-apy");
  assert.equal(s.grade(trace([{ name: "lend_list_tokens", args: {} }]), {}).pass, true);
  assert.equal(s.grade(trace([{ name: "price_get", args: {} }]), {}).pass, false);
});

test("decodes required signers from a real v0 transaction", () => {
  const wallet = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  const other = new PublicKey("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH");
  const message = MessageV0.compile({
    payerKey: wallet,
    recentBlockhash: "11111111111111111111111111111111" as Blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: other, lamports: 1 })],
  });
  const b64 = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
  assert.deepEqual(requiredSigners(b64), [wallet.toBase58()]);

  const withTx = trace([order(SOL.mint, USDC.mint, "100000000", {}, { transaction: b64 })]);
  const good = expectSwap(withTx, { wallet: wallet.toBase58() }, { from: SOL, to: USDC, uiAmount: 0.1 });
  assert.ok(good.every((c) => c.pass));
  const bad = expectSwap(withTx, { wallet: other.toBase58() }, { from: SOL, to: USDC, uiAmount: 0.1 });
  assert.deepEqual(bad.filter((c) => !c.pass).map((c) => c.name), ["user's wallet signs the transaction"]);
});
