---
name: loretech
description: Conversation materializer. Turns conversation context into living, enriched, shareable artifacts (Echoes) — persistent at a URL, evolving over time.
metadata:
  version: "0.5.0"
  author: "loretech"
  app: "https://loretech.archive.energy"
---

## Credentials

**NEVER read, print, log, or include API keys in conversation context, tool arguments, or echo content.** The MCP server handles all authentication internally — you never need to touch secrets directly.

Credentials are injected into the MCP server process via `env` block in the MCP config. The server reads them from `process.env` automatically. You do not need to find, read, or pass API keys — just call the MCP tools.

If the MCP server reports "Missing API keys", tell the user to re-run `bunx loretech` to reconfigure. Do NOT attempt to read `.env` files, search for keys, or resolve this yourself.

## When to use

Materialize an Echo whenever conversation produces understanding worth making visible.

Good triggers:
- The conversation surfaced something worth investigating further
- A claim needs verification with real sources
- Multiple threads are converging — synthesize them into a shareable artifact
- The user needs a briefing, comparison, or competitive analysis
- An agent or pipeline has context worth persisting beyond the session
- The user wants to track an evolving situation over time

Do NOT create an echo for:
- Simple factual questions you can answer directly
- Code generation or debugging
- Pure opinion questions with no research component

## How it works

You send conversation context to the engine. It materializes a living artifact.

```
POST /echo with context
  → Engine extracts taste signals from your context
  → Engine searches across papers, news, tweets, blogs, filings
  → Engine composes editorial synthesis
  → Returns echo at a shareable URL
You write .loretech/echoes/{id}.md
```

The echo persists. Share the URL. Come back later — it may have evolved as new sources arrived or datasets completed.

## Setup

Run `bunx loretech` in the project directory. This creates:

```
.loretech/
├── .env        # API keys (gitignored)
└── echoes/     # echo .md files
```

For global install: `bunx loretech --global` → `~/.loretech/`

## Creating an Echo

Use the `loretech_echo` MCP tool. The server handles authentication automatically — never construct API calls with raw keys.

### The `context` field

The seed of the echo. Send whatever context is relevant — a specific question, conversation history, a half-formed idea, a full research brief. The richer the context, the sharper the echo. The engine extracts taste signals (interests, source preferences, rejection patterns) automatically.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `context` | yes | What to investigate. Include relevant conversation context. The richer, the sharper. |
| `depth` | no | `"quick"` (~10s, fast take + 3 sources), `"standard"` (~30s, full synthesis, 8+ sources), `"deep"` (~60s, comprehensive, 15+ sources + async dataset) |
| `focus` | no | `"academic"` (papers, arxiv), `"industry"` (news, companies), `"discourse"` (tweets, blogs), `"financial"` (filings, reports), or omit for auto |
| `intent` | no | Shapes research strategy and composition voice. See intent table below. |
| `signals` | no | Structured hints from smart sources. See signals table below. |
| `scope` | no | Memory isolation boundary. Same scope shares taste, different scope is isolated. |
| `source` | no | Attribution: `{ type, id?, label? }`. Type is `human`, `agent`, `swarm`, `pipeline`, or `webhook`. |
| `echoId` | no | Existing echo ID to update/enrich. URL stays the same — content evolves. |
| `model` | no | OpenRouter model ID for composition. Default: engine default. |

### Intent

Intent shapes both what the engine looks for and how it writes.

| Intent | Research behavior | Composition voice |
|--------|------------------|-------------------|
| `explore` | Wide net. Cross-domain. Unexpected connections. | Curious, expansive. "Here's what the landscape looks like." |
| `verify` | Targeted. Seeks confirming AND disconfirming evidence. | Rigorous, balanced. "Here's what the evidence says." |
| `track` | Temporal. Recent changes, trend lines, trajectory. | Observational, evolving. "Here's what changed and where it's heading." |
| `compare` | Structured. Side-by-side evaluation across dimensions. | Analytical, fair. "Here's how these alternatives stack up." |
| `brief` | Selective. Key facts, executive summary, decision-ready. | Tight, decisive. "Here's what you need to know." |

Omit to let the engine infer intent from context.

### Signals

Structured hints from intelligent sources — agents, swarms, pipelines — that already have context. Skip these when the source is a human typing a question. Fill them when the source is an agent or pipeline that has already done work.

| Field | Type | Description |
|-------|------|-------------|
| `signals.known` | `string[]` | What the source already knows. Engine skips common ground, goes deeper. |
| `signals.claims` | `string[]` | Specific claims to verify or challenge. |
| `signals.domains` | `string[]` | Relevant expertise domains (e.g. "distributed systems"). Shapes source selection. |
| `signals.avoid` | `string[]` | Topics, sources, or framings to deprioritize. |
| `signals.entities` | `string[]` | Central people, companies, papers, or projects. Seeds entity-aware research. |

### Source

Attribution for who initiated this echo.

| Field | Type | Description |
|-------|------|-------------|
| `source.type` | `"human"` \| `"agent"` \| `"swarm"` \| `"pipeline"` \| `"webhook"` | What kind of intelligence initiated this echo. |
| `source.id` | `string` | Identifier (agent name, pipeline ID, webhook slug). |
| `source.label` | `string` | Human-readable label (e.g. "Scott via Claude Desktop"). |

### Response

```json
{
  "echoId": "echo-m4x7k9",
  "status": "draft",
  "title": "Post-Quantum TLS Is Shipping Quietly",
  "subtitle": "Three independent browser teams are landing PQ key exchange with zero fanfare",
  "tags": ["post-quantum cryptography", "TLS", "browsers"],
  "sources": [
    { "url": "...", "title": "...", "type": "paper", "domain": "arxiv.org", "category": "research paper" }
  ],
  "markdown": "# Post-Quantum TLS Is Shipping Quietly\n\n...",
  "privateUrl": "https://loretech.archive.energy/echo/echo-m4x7k9?key=abc123...",
  "privateKey": "abc123...",
  "markdownUrl": "https://loretech.archive.energy/echo/echo-m4x7k9.md?key=abc123..."
}
```

### After receiving a response

1. **Share `privateUrl`** with the user — they open it alongside the chat
2. **Write the echo** to `.loretech/echoes/{echoId}.md` — YAML frontmatter + full markdown body

The `.md` file format:
```yaml
---
echoId: echo-m4x7k9
privateKey: abc123...
title: "Post-Quantum TLS Is Shipping Quietly"
status: draft
createdAt: 2026-02-27T00:00:00Z
updatedAt: 2026-02-27T00:00:00Z
---

# Post-Quantum TLS Is Shipping Quietly
...full echo body...
```

## Updating an Echo

As the conversation evolves, enrich the echo with new context. Use `loretech_echo` with the `echoId` parameter set to the existing echo ID. The server reads the `privateKey` from your local `.loretech/echoes/{echoId}.md` frontmatter automatically — you never need to handle auth tokens.

The echo URL stays the same — the user refreshes to see the enriched version. The local `.md` file is overwritten with the updated content.

## Deep Echoes (Webset Datasets)

When `depth: "deep"` is used, the engine also creates an **Exa Webset** — an async structured dataset of typed entities with enrichments. This runs in the background.

The response includes `websetId` and `websetStatus: "processing"`. Poll `GET /echo/:id` until `websetStatus` becomes `"completed"`. When ready, the response includes a `dataset` array. Write it to `.loretech/echoes/{echoId}.json`.

## Resuming a session

Before creating a new echo, check `.loretech/echoes/` for existing echo `.md` files. If the user wants to update an existing one, pass `echoId` to `loretech_echo` — the server reads the private key from the local echo file automatically.

## Publishing

When the user wants to make an echo public, use the publish endpoint. The `privateKey` is in the echo's `.md` frontmatter — the MCP server handles this automatically when a publish tool is available.

## Source categories

| Category | What it finds | When it's used |
|----------|--------------|----------------|
| General web | Articles, blog posts, documentation | Always |
| Tweet | X/Twitter threads and posts | Auto or `focus: "discourse"` |
| Research paper | arxiv, OpenReview, Semantic Scholar | Auto or `focus: "academic"` |
| News | Recent news articles | Auto or `focus: "industry"` |
| Personal site | Practitioner blogs, personal sites | Standard/deep depth |
| Financial report | SEC filings, investor reports | `focus: "financial"` |
| Company | Company pages, about pages | `focus: "industry"` at standard+ depth |

## MCP Tools

Agents use Loretech via MCP (Model Context Protocol). The HTTP API docs above show the engine contract — you interact through these tools:

### `loretech_echo`

Materialize or update an echo. Main tool — use this whenever conversation produces understanding worth making visible.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `context` | string | yes | What to investigate. Richer is better. |
| `depth` | `"quick"` \| `"standard"` \| `"deep"` | no | Research depth. Default: `"standard"`. |
| `focus` | `"academic"` \| `"industry"` \| `"discourse"` \| `"financial"` | no | Research focus. Default: auto. |
| `intent` | `"explore"` \| `"verify"` \| `"track"` \| `"compare"` \| `"brief"` | no | Research strategy + composition voice. Default: inferred. |
| `signals` | object | no | `{ known?, claims?, domains?, avoid?, entities? }` — structured hints from smart sources. |
| `scope` | string | no | Memory isolation boundary. Same scope shares taste. |
| `source` | object | no | `{ type, id?, label? }` — attribution/provenance. |
| `echoId` | string | no | Existing echo ID to update/enrich. |
| `model` | string | no | OpenRouter model ID. Default: engine default. |

Returns: echo metadata, `privateUrl`, source count, run path, full markdown.

### `loretech_runs`

List recent echo pipeline runs with status and timing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Max runs to show. Default: 10. |

Returns: formatted list of runs with ✓/✗/… status, duration, echoId, and step breakdown.

### `loretech_inspect`

Read a specific artifact from a run directory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runId` | string | yes | Run ID to inspect. |
| `artifact` | string | no | Filename (e.g. `sources.json`, `echo.md`). Omit to list all. |

Artifacts: `context.json`, `sources.json`, `echo.md`, `meta.json`, `dataset.json`.

### `loretech_rerun`

Replay an echo pipeline from a specific step with optional context override.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runId` | string | yes | Original run ID to replay from. |
| `fromStep` | `"context"` \| `"sources"` \| `"compose"` | no | Step to replay from. Default: `"context"`. |
| `context` | string | no | Override context (only when replaying from `"context"` step). |

Returns: new run metadata with echoId and status.

## Important

- **NEVER expose API keys** — do not read, print, log, or include any key values in messages, tool arguments, or echo content. The MCP server handles all authentication. If keys are missing, tell the user to run `bunx loretech`.
- Always tell the user when you're materializing an echo
- Share the `privateUrl` — they open it alongside the chat
- Write echo files to `.loretech/echoes/` after every `loretech_echo` call
- Check `.loretech/echoes/` before creating — offer to update if relevant
- Inference uses the user's OpenRouter key — their cost
- Research uses the user's Exa key — their cost
- Echoes are **private by default** — only accessible with the private key
- Publishing is explicit — user decides what enters the public feed
