/**
 * Loretech MCP Server
 *
 * Persistent MCP server that gives host agents (Claude Desktop, Cursor, etc.)
 * tools for creating echoes, inspecting runs, and replaying steps.
 *
 * Transport: stdio (host agent starts/stops automatically).
 *
 * Each echo run materializes artifacts to .loretech/runs/{runId}/ in real time,
 * giving the user a transparent, inspectable, replayable research pipeline.
 */


import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findLoretechDir, readEchoRefs, writeEchoRef } from "./memory.js";
import { echoInputSchema } from "./schema.js";
import {
  completeRun,
  createRun,
  listArtifacts,
  listRuns,
  readArtifact,
  readMeta,
  updateStep,
  writeArtifact,
} from "./runs.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  const envPath = path.join(findLoretechDir(), ".env");
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const LORETECH_API =
  process.env.LORETECH_API_URL ?? "https://loretech.archive.energy";

// ---------------------------------------------------------------------------
// Webset dataset polling — runs in background after echo creation.
// Polls engine for dataset completion, then writes locally.
// ---------------------------------------------------------------------------
function pollWebsetDataset(
  echoId: string,
  privateKey: string,
  runId: string,
  exaKey: string,
): void {
  const MAX_ATTEMPTS = 30;
  const INTERVAL_MS = 10_000;
  let attempts = 0;

  const poll = async () => {
    attempts++;
    try {
      const res = await fetch(
        `${LORETECH_API}/echo/${echoId}`,
        {
          headers: {
            Authorization: `Bearer ${privateKey}`,
            "X-Exa-Key": exaKey,
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) return;

      const data = await res.json() as {
        websetStatus?: string;
        dataset?: unknown[];
      };

      if (data.websetStatus === "completed" && data.dataset?.length) {
        // Write dataset to run directory
        writeArtifact(runId, "dataset.json", JSON.stringify(data.dataset, null, 2));
        updateStep(runId, "webset", "completed");

        // Write dataset to echoes directory
        const echoesDir = path.join(findLoretechDir(), "echoes");
        fs.writeFileSync(
          path.join(echoesDir, `${echoId}.json`),
          JSON.stringify(data.dataset, null, 2),
          "utf-8",
        );
        return; // Done — stop polling
      }
    } catch {
      // Transient error — keep trying
    }

    if (attempts < MAX_ATTEMPTS) {
      setTimeout(poll, INTERVAL_MS);
    } else {
      updateStep(runId, "webset", "completed"); // Mark done even if dataset never arrived
    }
  };

  setTimeout(poll, INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: "loretech",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool: loretech_echo — Create an echo from context
// ---------------------------------------------------------------------------

server.registerTool(
  "loretech_echo",
  {
    title: "Materialize Echo",
    description: [
      "Materialize an Echo — a living artifact from conversation context.",
      "Context in, persistent enriched artifact out. The engine researches,",
      "composes, and returns a structured artifact at a shareable URL.",
      "Artifacts materialize step-by-step in .loretech/runs/{runId}/.",
      "",
      "Use this when conversation produces understanding worth making visible —",
      "research, verification, tracking, comparison, or briefing.",
    ].join("\n"),
    inputSchema: echoInputSchema.shape,
  },
  async (args) => {
    const env = loadEnv();
    const loretechKey = env.LORETECH_API_KEY;
    const openrouterKey = env.OPENROUTER_API_KEY;
    const exaKey = env.EXA_API_KEY;

    if (!loretechKey || !openrouterKey || !exaKey) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Missing API keys. Run `bunx loretech` to configure.",
          },
        ],
        isError: true,
      };
    }

    // Create run directory for artifact staging
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createRun(runId);

    // Write context artifact (includes all input fields for replay)
    updateStep(runId, "context", "running");
    const contextArtifact: Record<string, unknown> = {
      context: args.context,
      depth: args.depth,
      focus: args.focus,
      intent: args.intent,
      signals: args.signals,
      scope: args.scope,
      source: args.source,
    };
    writeArtifact(
      runId,
      "context.json",
      JSON.stringify(contextArtifact, null, 2),
    );
    updateStep(runId, "context", "completed", "context.json");

    // Call engine
    updateStep(runId, "sources", "running");

    try {
      const body: Record<string, unknown> = {
        context: args.context,
        depth: args.depth,
      };
      if (args.focus) body.focus = args.focus;
      if (args.intent) body.intent = args.intent;
      if (args.signals) body.signals = args.signals;
      if (args.scope) body.scope = args.scope;
      if (args.source) body.source = args.source;
      if (args.echoId) body.echoId = args.echoId;
      if (args.model) body.model = args.model;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Loretech-Key": loretechKey,
        "X-OpenRouter-Key": openrouterKey,
        "X-Exa-Key": exaKey,
      };

      if (env.DISPLAY_NAME) headers["X-Display-Name"] = env.DISPLAY_NAME;
      if (env.X_HANDLE) headers["X-Handle"] = env.X_HANDLE;

      // If updating, add auth
      if (args.echoId) {
        const existing = readEchoRefs().find((r) => r.echoId === args.echoId);
        if (existing?.privateKey) {
          headers.Authorization = `Bearer ${existing.privateKey}`;
        }
      }

      const res = await fetch(`${LORETECH_API}/echo`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        updateStep(runId, "sources", "failed");
        completeRun(runId, { error: `Engine returned ${res.status}: ${text}` });
        return {
          content: [
            {
              type: "text" as const,
              text: `Echo creation failed (${res.status}): ${text}`,
            },
          ],
          isError: true,
        };
      }

      const data = (await res.json()) as {
        echoId: string;
        status: string;
        title: string;
        subtitle?: string;
        markdown: string;
        tags: string[];
        sources: Array<{
          url: string;
          title: string;
          type: string;
          domain: string;
          score?: number;
        }>;
        privateUrl: string;
        privateKey: string;
        createdAt: string;
        updatedAt: string;
        websetId?: string;
        websetStatus?: string;
      };

      // Write source artifacts
      writeArtifact(
        runId,
        "sources.json",
        JSON.stringify(data.sources, null, 2),
      );
      updateStep(runId, "sources", "completed", "sources.json");

      // Write echo artifact
      updateStep(runId, "compose", "running");
      writeArtifact(runId, "echo.md", data.markdown);
      updateStep(runId, "compose", "completed", "echo.md");

      // Write to echoes directory (persistent)
      updateStep(runId, "store", "running");
      writeEchoRef({
        echoId: data.echoId,
        privateKey: data.privateKey,
        title: data.title,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        markdown: data.markdown,
      });
      updateStep(runId, "store", "completed");
      updateStep(runId, "record", "completed");

      // Mark webset step — poll for dataset in background
      if (data.websetId) {
        updateStep(runId, "webset", "running");
        pollWebsetDataset(data.echoId, data.privateKey, runId, exaKey!);
      } else {
        updateStep(runId, "webset", "completed");
      }

      completeRun(runId, { echoId: data.echoId });

      // Build response
      const tagLine = data.tags.length ? `\nTags: ${data.tags.join(", ")}` : "";
      const sourceLine = `\nSources: ${data.sources.length} found`;
      const websetLine = data.websetId
        ? `\nWebset: ${data.websetStatus} (enriching in background)`
        : "";
      const runLine = `\nRun artifacts: .loretech/runs/${runId}/`;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `# ${data.title}`,
              data.subtitle ? `*${data.subtitle}*` : "",
              tagLine,
              sourceLine,
              websetLine,
              runLine,
              "",
              `Private URL: ${data.privateUrl}`,
              `Echo saved to: .loretech/echoes/${data.echoId}.md`,
              "",
              "---",
              "",
              data.markdown,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      completeRun(runId, { error: msg });
      return {
        content: [
          { type: "text" as const, text: `Echo creation failed: ${msg}` },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: loretech_runs — List recent runs
// ---------------------------------------------------------------------------

server.registerTool(
  "loretech_runs",
  {
    title: "List Runs",
    description:
      "List recent echo pipeline runs with their status and artifacts. " +
      "Each run has a .loretech/runs/{runId}/ directory with step-by-step artifacts.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of runs to return"),
    },
  },
  async (args) => {
    const runs = listRuns(args.limit);
    if (runs.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No runs found. Create an echo first with loretech_echo.",
          },
        ],
      };
    }

    const lines = runs.map((run) => {
      const steps = run.steps
        .filter((s) => s.status !== "pending")
        .map(
          (s) =>
            `${s.status === "completed" ? "✓" : s.status === "failed" ? "✗" : "…"} ${s.name}`,
        )
        .join(", ");
      const duration =
        run.completedAt
          ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
          : "running";
      return `${run.status === "completed" ? "✓" : run.status === "failed" ? "✗" : "…"} ${run.runId} (${duration}) ${run.echoId ? `→ ${run.echoId}` : ""}\n  Steps: ${steps}`;
    });

    return {
      content: [{ type: "text" as const, text: lines.join("\n\n") }],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: loretech_inspect — Read a run artifact
// ---------------------------------------------------------------------------

server.registerTool(
  "loretech_inspect",
  {
    title: "Inspect Run Artifact",
    description:
      "Read a specific artifact from an echo pipeline run. " +
      "Artifacts include context.json, sources.json, echo.md, meta.json, dataset.json.",
    inputSchema: {
      runId: z.string().describe("The run ID to inspect"),
      artifact: z
        .string()
        .optional()
        .describe(
          "Specific artifact filename to read (e.g., 'sources.json'). Omit to list all artifacts.",
        ),
    },
  },
  async (args) => {
    if (!args.artifact) {
      // List artifacts
      const artifacts = listArtifacts(args.runId);
      if (artifacts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No artifacts found for run ${args.runId}.`,
            },
          ],
        };
      }
      const meta = readMeta(args.runId);
      const header = meta
        ? `Run ${args.runId} (${meta.status})${meta.echoId ? ` → ${meta.echoId}` : ""}\n\n`
        : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `${header}Artifacts:\n${artifacts.map((a) => `  • ${a}`).join("\n")}`,
          },
        ],
      };
    }

    // Read specific artifact
    const content = readArtifact(args.runId, args.artifact);
    if (content === null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Artifact '${args.artifact}' not found in run ${args.runId}.`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text" as const, text: content }],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: loretech_rerun — Replay from a specific step
// ---------------------------------------------------------------------------

server.registerTool(
  "loretech_rerun",
  {
    title: "Rerun from Step",
    description: [
      "Replay an echo pipeline from a specific step, optionally with modified inputs.",
      "Use this when the user wants to adjust signals, change context, or retry a failed step.",
      "Reads existing artifacts from the original run and creates a new run from the specified step.",
    ].join("\n"),
    inputSchema: {
      runId: z.string().describe("The original run ID to replay from"),
      fromStep: z
        .enum(["context", "sources", "compose"])
        .describe("Step to restart from (reuses all prior artifacts)"),
      overrideContext: z
        .string()
        .optional()
        .describe("New context to use (only when fromStep is 'context')"),
    },
  },
  async (args) => {
    const originalMeta = readMeta(args.runId);
    if (!originalMeta) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Run ${args.runId} not found.`,
          },
        ],
        isError: true,
      };
    }

    // Read context from original run
    const contextRaw = readArtifact(args.runId, "context.json");
    if (!contextRaw) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No context.json found in run ${args.runId}. Cannot replay.`,
          },
        ],
        isError: true,
      };
    }

    const originalContext = JSON.parse(contextRaw) as {
      context: string;
      depth: string;
      focus?: string;
      intent?: string;
      signals?: Record<string, unknown>;
      scope?: string;
      source?: Record<string, unknown>;
    };

    // Override context if provided and replaying from context step
    const context =
      args.fromStep === "context" && args.overrideContext
        ? args.overrideContext
        : originalContext.context;

    // Create new echo with the (possibly modified) context
    // The engine handles the full pipeline — we just stage artifacts locally
    const env = loadEnv();
    const loretechKey = env.LORETECH_API_KEY;
    const openrouterKey = env.OPENROUTER_API_KEY;
    const exaKey = env.EXA_API_KEY;

    if (!loretechKey || !openrouterKey || !exaKey) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Missing API keys. Run `bunx loretech` to configure.",
          },
        ],
        isError: true,
      };
    }

    const newRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createRun(newRunId);

    // Copy context (possibly modified)
    updateStep(newRunId, "context", "running");
    writeArtifact(
      newRunId,
      "context.json",
      JSON.stringify(
        {
          context,
          depth: originalContext.depth,
          focus: originalContext.focus,
          replayedFrom: args.runId,
          replayedStep: args.fromStep,
        },
        null,
        2,
      ),
    );
    updateStep(newRunId, "context", "completed", "context.json");

    // Call engine with the context
    updateStep(newRunId, "sources", "running");

    try {
      const body: Record<string, unknown> = {
        context,
        depth: originalContext.depth,
      };
      if (originalContext.focus) body.focus = originalContext.focus;
      if (originalContext.intent) body.intent = originalContext.intent;
      if (originalContext.signals) body.signals = originalContext.signals;
      if (originalContext.scope) body.scope = originalContext.scope;
      if (originalContext.source) body.source = originalContext.source;

      const res = await fetch(`${LORETECH_API}/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Loretech-Key": loretechKey,
          "X-OpenRouter-Key": openrouterKey,
          "X-Exa-Key": exaKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        updateStep(newRunId, "sources", "failed");
        completeRun(newRunId, {
          error: `Engine returned ${res.status}: ${text}`,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Rerun failed (${res.status}): ${text}`,
            },
          ],
          isError: true,
        };
      }

      const data = (await res.json()) as {
        echoId: string;
        status: string;
        title: string;
        subtitle?: string;
        markdown: string;
        tags: string[];
        sources: Array<{
          url: string;
          title: string;
          type: string;
          domain: string;
        }>;
        privateUrl: string;
        privateKey: string;
        createdAt: string;
        updatedAt: string;
        websetId?: string;
        websetStatus?: string;
      };

      writeArtifact(
        newRunId,
        "sources.json",
        JSON.stringify(data.sources, null, 2),
      );
      updateStep(newRunId, "sources", "completed", "sources.json");

      updateStep(newRunId, "compose", "running");
      writeArtifact(newRunId, "echo.md", data.markdown);
      updateStep(newRunId, "compose", "completed", "echo.md");

      updateStep(newRunId, "store", "running");
      writeEchoRef({
        echoId: data.echoId,
        privateKey: data.privateKey,
        title: data.title,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        markdown: data.markdown,
      });
      updateStep(newRunId, "store", "completed");
      updateStep(newRunId, "record", "completed");
      updateStep(
        newRunId,
        "webset",
        data.websetId ? "running" : "completed",
      );

      completeRun(newRunId, { echoId: data.echoId });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Rerun complete: ${data.title}`,
              `Original run: ${args.runId} → New run: ${newRunId}`,
              `Replayed from: ${args.fromStep}${args.overrideContext ? " (with modified context)" : ""}`,
              `Echo: .loretech/echoes/${data.echoId}.md`,
              `Run artifacts: .loretech/runs/${newRunId}/`,
              `Private URL: ${data.privateUrl}`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      completeRun(newRunId, { error: msg });
      return {
        content: [
          { type: "text" as const, text: `Rerun failed: ${msg}` },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write("Loretech MCP server started\n");
}

export { server };
