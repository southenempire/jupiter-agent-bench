import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runAgent, type Effort } from "./agent.js";
import { renderReport } from "./report.js";
import type { RunFile } from "./results.js";
import { SCENARIOS } from "./scenarios.js";
import { connectJupiterMcp, isLandingTool, JUPITER_MCP_URL } from "./tools.js";

try {
  // Lets people keep ANTHROPIC_API_KEY in a gitignored .env instead of exporting it.
  process.loadEnvFile(".env");
} catch {
  // no .env, fine
}

const { values } = parseArgs({
  options: {
    models: { type: "string", default: "claude-opus-5-5" },
    scenarios: { type: "string" },
    effort: { type: "string", default: "medium" },
    trials: { type: "string", default: "1" },
    wallet: { type: "string", default: process.env.BENCH_WALLET },
    "mcp-url": { type: "string", default: JUPITER_MCP_URL },
    out: { type: "string", default: "results" },
    list: { type: "boolean", default: false },
  },
});

if (values.list) {
  for (const s of SCENARIOS) console.log(`${s.id.padEnd(22)} ${s.category.padEnd(12)} ${s.prompt}`);
  process.exit(0);
}

const models = values.models!.split(",").map((m) => m.trim()).filter(Boolean);
const effort = values.effort as Effort;
const trials = Math.max(1, Number(values.trials));
const wanted = values.scenarios?.split(",").map((s) => s.trim());
const scenarios = wanted ? SCENARIOS.filter((s) => wanted.includes(s.id)) : SCENARIOS;
if (wanted && scenarios.length !== wanted.length) {
  const known = new Set(SCENARIOS.map((s) => s.id));
  console.error(`Unknown scenario(s): ${wanted.filter((w) => !known.has(w)).join(", ")}. Run with --list.`);
  process.exit(1);
}

const wallet = values.wallet || undefined;
const client = new Anthropic();

// Fail before touching Jupiter if the key or a model name is wrong, rather
// than recording every scenario as a failure.
for (const model of models) {
  try {
    await client.models.retrieve(model);
  } catch (err) {
    if (err instanceof Anthropic.NotFoundError) {
      console.error(`Unknown model "${model}". Check the --models list.`);
    } else if (err instanceof Anthropic.AuthenticationError || !(err instanceof Anthropic.APIError)) {
      console.error(
        `Could not authenticate with the Anthropic API (${(err as Error).message}).\n` +
          "Set ANTHROPIC_API_KEY in this terminal, or put ANTHROPIC_API_KEY=sk-ant-... in a .env file in this folder.",
      );
    } else {
      console.error(`Anthropic API error checking ${model}: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

const tools = await connectJupiterMcp({ url: values["mcp-url"], apiKey: process.env.JUPITER_API_KEY });
const toolDefs = await tools.listTools();
const blockedTools = toolDefs.filter(isLandingTool).map((t) => t.name);

console.log(`Connected to ${values["mcp-url"]}: ${toolDefs.length} tools (${blockedTools.length} landing tools blocked)`);
console.log(`Wallet: ${wallet ?? "none (quote-only runs)"}\n`);

const run: RunFile = {
  startedAt: new Date().toISOString(),
  config: {
    models,
    effort,
    trials,
    wallet: wallet ?? null,
    mcpUrl: values["mcp-url"]!,
    toolCount: toolDefs.length,
    blockedTools,
  },
  results: [],
};

try {
  for (const model of models) {
    for (const scenario of scenarios) {
      for (let trial = 1; trial <= trials; trial++) {
        // Sequential on purpose: keyless MCP access is rate limited.
        const trace = await runAgent({
          client,
          model,
          effort,
          tools,
          toolDefs,
          scenarioId: scenario.id,
          prompt: scenario.prompt,
          wallet,
        });
        const g = scenario.grade(trace, { wallet });
        run.results.push({ model, scenarioId: scenario.id, trial, grade: g, trace });

        const failed = g.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
        console.log(`${g.pass ? "PASS" : "FAIL"}  ${model}  ${scenario.id}${trials > 1 ? ` #${trial}` : ""}`);
        for (const f of failed) console.log(`        ✗ ${f}`);
      }
    }
  }
} finally {
  await tools.close();
}

mkdirSync(values.out!, { recursive: true });
const stamp = run.startedAt.replace(/[:.]/g, "-");
const jsonPath = join(values.out!, `run-${stamp}.json`);
const htmlPath = join(values.out!, `report-${stamp}.html`);
writeFileSync(jsonPath, JSON.stringify(run, null, 2));
writeFileSync(htmlPath, renderReport(run, scenarios));

console.log("");
for (const model of models) {
  const mine = run.results.filter((r) => r.model === model);
  const passed = mine.filter((r) => r.grade.pass).length;
  console.log(`${model}: ${passed}/${mine.length} passed`);
}
console.log(`\nWrote ${jsonPath}\nWrote ${htmlPath}`);
