/**
 * Echo Input Schema — the universal contract.
 *
 * Any transport (MCP, HTTP, SDK, webhook) imports this schema.
 * Any LLM that reads the field descriptions can fill it.
 * One required field. Everything else is optional signal.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Structured signals — hints from smart sources that bypass cold-start
// ---------------------------------------------------------------------------

export const signalsSchema = z.object({
  known: z
    .array(z.string())
    .optional()
    .describe(
      "Things the source already knows about this topic. Lets the engine skip common ground and go deeper.",
    ),
  claims: z
    .array(z.string())
    .optional()
    .describe(
      "Specific claims to verify or challenge. The engine will seek confirming and disconfirming evidence.",
    ),
  domains: z
    .array(z.string())
    .optional()
    .describe(
      "Domains of expertise relevant to this context (e.g. 'distributed systems', 'behavioral economics'). Shapes source selection.",
    ),
  avoid: z
    .array(z.string())
    .optional()
    .describe(
      "Topics, sources, or framings to deprioritize. Useful when the source has already explored dead ends.",
    ),
  entities: z
    .array(z.string())
    .optional()
    .describe(
      "People, companies, papers, or projects that are central to this context. Seeds entity-aware research.",
    ),
});

// ---------------------------------------------------------------------------
// Source attribution — where this echo request originated
// ---------------------------------------------------------------------------

export const sourceModelSchema = z.object({
  model: z
    .string()
    .describe(
      "Model identifier (e.g. 'claude-opus-4-6', 'gemma-3-27b', 'minimax-m2.5').",
    ),
  role: z
    .string()
    .optional()
    .describe(
      "What this model contributed to filling the schema: 'orchestrator', 'context', 'signals', 'intent', etc.",
    ),
});

export const sourceSchema = z.object({
  type: z
    .enum(["human", "agent", "swarm", "pipeline", "webhook"])
    .describe("What kind of intelligence initiated this echo."),
  id: z
    .string()
    .optional()
    .describe("Identifier for the source (agent name, pipeline ID, webhook slug)."),
  label: z
    .string()
    .optional()
    .describe("Human-readable label for attribution (e.g. 'Scott via Claude Desktop')."),
  models: z
    .array(sourceModelSchema)
    .optional()
    .describe(
      "Models that contributed to filling this schema. Single agent: one entry. Swarm/pipeline: multiple entries with roles.",
    ),
});

// ---------------------------------------------------------------------------
// Echo input schema — the full contract
// ---------------------------------------------------------------------------

export const echoInputSchema = z.object({
  context: z
    .string()
    .describe(
      "What to investigate. This is the seed — a question, a conversation excerpt, a half-formed idea, a full research brief. " +
        "The richer the context, the sharper the echo. Include what you're trying to understand, what you've already explored, " +
        "and what would make this echo useful. The engine extracts taste signals automatically — you don't need to structure anything.",
    ),
  depth: z
    .enum(["quick", "standard", "deep"])
    .default("standard")
    .describe(
      "Research depth: quick (~10s, fast take + 3 sources), standard (~30s, full synthesis, 8+ sources), deep (~60s, comprehensive + async dataset).",
    ),
  focus: z
    .enum(["academic", "industry", "discourse", "financial"])
    .optional()
    .describe(
      "Shape research category weights. academic: papers, arxiv. industry: news, companies. discourse: tweets, blogs. financial: filings, reports. Omit for auto-detection.",
    ),
  intent: z
    .enum(["explore", "verify", "track", "compare", "brief"])
    .optional()
    .describe(
      "Shapes both research strategy and composition voice. " +
        "explore: open-ended investigation, cast a wide net. " +
        "verify: challenge specific claims with evidence. " +
        "track: monitor an evolving situation over time. " +
        "compare: evaluate alternatives side-by-side. " +
        "brief: produce a tight, executive-ready summary. " +
        "Omit to let the engine infer from context.",
    ),
  signals: signalsSchema
    .optional()
    .describe(
      "Structured hints from intelligent sources — agents, swarms, pipelines — that already have context. " +
        "Bypass cold-start by telling the engine what you already know, what to verify, which domains matter, and what to avoid.",
    ),
  scope: z
    .string()
    .optional()
    .describe(
      "Memory isolation boundary. Echoes with the same scope share taste memory (interests, preferences, rejection patterns). " +
        "Different scopes are fully isolated. Use project names, session IDs, or any string. Omit for the default scope.",
    ),
  source: sourceSchema
    .optional()
    .describe(
      "Where this echo request originated. Attribution and provenance — useful for multi-agent systems, pipelines, and audit trails.",
    ),
  echoId: z
    .string()
    .optional()
    .describe("Existing echo ID to update instead of creating new. The echo URL stays the same — content evolves."),
  model: z
    .string()
    .optional()
    .describe("Override composition model (OpenRouter model ID). Default: engine default."),
});

export type EchoInput = z.infer<typeof echoInputSchema>;
export type EchoSignals = z.infer<typeof signalsSchema>;
export type EchoSource = z.infer<typeof sourceSchema>;
export type EchoSourceModel = z.infer<typeof sourceModelSchema>;
