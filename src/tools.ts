import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutput {
  text: string;
  isError: boolean;
}

/** Anything the agent can call tools on: the live Jupiter MCP, or a fake in tests. */
export interface ToolSource {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolOutput>;
  close(): Promise<void>;
}

export const JUPITER_MCP_URL = "https://mcp.jup.ag";

export async function connectJupiterMcp(opts: { url?: string; apiKey?: string } = {}): Promise<ToolSource> {
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const transport = new StreamableHTTPClientTransport(new URL(opts.url ?? JUPITER_MCP_URL), {
    requestInit: { headers },
  });
  const client = new Client({ name: "jupiter-agent-bench", version: "0.1.0" });
  await client.connect(transport);

  return {
    async listTools() {
      const out: ToolDef[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const t of page.tools) {
          out.push({
            name: t.name,
            description: t.description ?? "",
            inputSchema: t.inputSchema as Record<string, unknown>,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    },
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args });
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content
        .map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
        .join("\n");
      return { text, isError: Boolean(res.isError) };
    },
    close: () => client.close(),
  };
}

// Anything that lands a transaction on-chain. The bench never holds a key, so
// these could only ever receive a fabricated "signed" payload; blocking them
// keeps runs side-effect free and lets us record that the agent tried.
const LANDING_TOOL = /(execute|submit|land|broadcast)/i;

export function isLandingTool(tool: ToolDef): boolean {
  if (LANDING_TOOL.test(tool.name)) return true;
  const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  return Object.keys(props).some((k) => /signed/i.test(k));
}

export const BLOCKED_MESSAGE =
  "Blocked by benchmark harness: this environment is dry-run only. Transactions are never signed or submitted; return the prepared order to the user instead.";
