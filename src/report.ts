import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { RunFile, RunResult } from "./results.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const clip = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more chars)` : s);

function cell(results: RunResult[]): string {
  if (!results.length) return `<td class="na">–</td>`;
  const passed = results.filter((r) => r.grade.pass).length;
  const cls = passed === results.length ? "pass" : passed === 0 ? "fail" : "mixed";
  const label = results.length === 1 ? (passed ? "pass" : "fail") : `${passed}/${results.length}`;
  return `<td class="${cls}"><a href="#${esc(anchor(results[0]))}">${label}</a></td>`;
}

const anchor = (r: RunResult) => `r-${r.model}-${r.scenarioId}-${r.trial}`;

function detail(r: RunResult, scenario: Scenario | undefined): string {
  const checks = r.grade.checks
    .map(
      (c) =>
        `<li class="${c.pass ? "ok" : "bad"}"><span class="mark">${c.pass ? "✓" : "✗"}</span> ${esc(c.name)} <span class="muted">— ${esc(c.detail)}</span></li>`,
    )
    .join("");
  const calls = r.trace.toolCalls.length
    ? r.trace.toolCalls
        .map(
          (c) => `<li>
            <div><b>${esc(c.name)}</b>${c.blocked ? ' <span class="tag bad">blocked</span>' : ""}${c.isError && !c.blocked ? ' <span class="tag">error</span>' : ""}</div>
            <pre>${esc(JSON.stringify(c.args, null, 2))}</pre>
            <details><summary>result</summary><pre>${esc(clip(c.output))}</pre></details>
          </li>`,
        )
        .join("")
    : "<li class=muted>No tool calls.</li>";

  return `<details class="run ${r.grade.pass ? "pass" : "fail"}" id="${esc(anchor(r))}">
    <summary><span class="badge ${r.grade.pass ? "pass" : "fail"}">${r.grade.pass ? "PASS" : "FAIL"}</span>
      <span class="sid">${esc(r.scenarioId)}</span> <span class="muted">${esc(r.model)}${r.trial > 1 ? ` · trial ${r.trial}` : ""}</span></summary>
    <div class="body">
      <p class="prompt">“${esc(r.trace.prompt)}”</p>
      ${scenario ? `<p class="muted">${esc(scenario.why)}</p>` : ""}
      <h4>Checks</h4><ul class="checks">${checks}</ul>
      <h4>Tool calls</h4><ol class="calls">${calls}</ol>
      <h4>Agent's final message</h4><pre class="final">${esc(r.trace.finalText || "(none)")}</pre>
      <p class="muted small">${r.trace.turns} turns · ${r.trace.inputTokens.toLocaleString()} in / ${r.trace.outputTokens.toLocaleString()} out tokens · ${(r.trace.durationMs / 1000).toFixed(1)}s${r.trace.error ? ` · error: ${esc(r.trace.error)}` : ""}</p>
    </div>
  </details>`;
}

export function renderReport(run: RunFile, scenarios: Scenario[] = SCENARIOS): string {
  const models = run.config.models;
  const ids = [...new Set(run.results.map((r) => r.scenarioId))];
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  const summary = models
    .map((m) => {
      const mine = run.results.filter((r) => r.model === m);
      const passed = mine.filter((r) => r.grade.pass).length;
      const pct = mine.length ? Math.round((passed / mine.length) * 100) : 0;
      return `<div class="stat"><div class="label">${esc(m)}</div><div class="value">${pct}%</div><div class="muted">${passed} of ${mine.length} runs passed</div></div>`;
    })
    .join("");

  const rows = ids
    .map((id) => {
      const s = byId.get(id);
      const cells = models.map((m) => cell(run.results.filter((r) => r.model === m && r.scenarioId === id))).join("");
      return `<tr><th scope="row"><div>${esc(s?.title ?? id)}</div><div class="muted small">${esc(s?.category ?? "")} · ${esc(id)}</div></th>${cells}</tr>`;
    })
    .join("");

  const details = run.results.map((r) => detail(r, byId.get(r.scenarioId))).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jupiter Agent Bench</title>
<style>
:root{--bg:#fbfbf9;--fg:#1d1f21;--muted:#6b6f76;--line:#e3e3df;--card:#fff;--pass:#1f7a4d;--pass-bg:#e3f4ea;--fail:#b3261e;--fail-bg:#fbe7e5;--mixed:#8a5a00;--mixed-bg:#fdf1d8;--code:#f3f3f0}
@media (prefers-color-scheme:dark){:root{--bg:#121416;--fg:#e6e6e3;--muted:#9a9ea5;--line:#2a2d31;--card:#1a1d20;--pass:#6fd39b;--pass-bg:#16301f;--fail:#ff8a80;--fail-bg:#3a1a18;--mixed:#f2c46b;--mixed-bg:#33290f;--code:#202327}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}h1{margin:0 0 4px;font-size:26px}h2{margin:36px 0 12px;font-size:18px}h4{margin:16px 0 6px;font-size:14px}
.muted{color:var(--muted)}.small{font-size:13px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}.stat .label{font-size:13px;color:var(--muted)}.stat .value{font-size:30px;font-weight:650}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}tr:last-child th,tr:last-child td{border-bottom:0}
thead th{font-size:13px;color:var(--muted);font-weight:600}tbody th .muted{font-weight:400}td{vertical-align:middle}td{text-align:center;font-weight:600;white-space:nowrap}td a{color:inherit;text-decoration:none}
td.pass{background:var(--pass-bg);color:var(--pass)}td.fail{background:var(--fail-bg);color:var(--fail)}td.mixed{background:var(--mixed-bg);color:var(--mixed)}
.run{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0}.run summary{padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.run .body{padding:0 14px 14px}.sid{font-weight:600}
.badge{font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px}.badge.pass{background:var(--pass-bg);color:var(--pass)}.badge.fail{background:var(--fail-bg);color:var(--fail)}
.tag{font-size:11px;padding:1px 6px;border-radius:4px;background:var(--code)}.tag.bad{background:var(--fail-bg);color:var(--fail)}
.checks{list-style:none;padding:0;margin:0}.checks li{padding:3px 0}.ok .mark{color:var(--pass)}.bad .mark{color:var(--fail)}
.calls{padding-left:18px}.calls li{margin:8px 0}
pre{background:var(--code);border-radius:8px;padding:10px;overflow-x:auto;font-size:12.5px;margin:6px 0;white-space:pre-wrap;word-break:break-word}
.prompt{font-size:16px;margin:4px 0}
</style></head><body><main>
<h1>Jupiter Agent Bench</h1>
<p class="muted">${esc(new Date(run.startedAt).toUTCString())} · ${run.config.toolCount} tools from ${esc(run.config.mcpUrl)} · effort ${esc(run.config.effort)} · ${run.config.wallet ? `wallet ${esc(run.config.wallet)}` : "no wallet (quote-only)"} · dry-run, nothing signed</p>
<div class="stats">${summary}</div>
<h2>Results by scenario</h2>
<div class="tablewrap"><table><thead><tr><th>Scenario</th>${models.map((m) => `<th>${esc(m)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
<h2>Every run</h2>
${details}
<p class="muted small">Blocked landing tools: ${esc(run.config.blockedTools.join(", ") || "none")}</p>
</main></body></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npm run report -- results/run-<timestamp>.json");
    process.exit(1);
  }
  const run = JSON.parse(readFileSync(input, "utf8")) as RunFile;
  const renamed = input.replace(/run-([^/]+)\.json$/, "report-$1.html");
  const out = renamed === input ? `${input}.html` : renamed;
  writeFileSync(out, renderReport(run));
  console.log(`Wrote ${out}`);
}
