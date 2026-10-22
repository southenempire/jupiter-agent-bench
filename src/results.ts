import type { Effort, Trace } from "./agent.js";
import type { Grade } from "./grade.js";

export interface RunResult {
  model: string;
  scenarioId: string;
  trial: number;
  grade: Grade;
  trace: Trace;
}

export interface RunFile {
  startedAt: string;
  config: {
    models: string[];
    effort: Effort;
    trials: number;
    wallet: string | null;
    mcpUrl: string;
    toolCount: number;
    blockedTools: string[];
  };
  results: RunResult[];
}
