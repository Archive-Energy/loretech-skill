#!/usr/bin/env bun

/**
 * LORETECH CLI
 *
 * Usage:
 *   bunx loretech init            # project-level install (default)
 *   bunx loretech init --global   # global (~/.loretech/)
 *   bunx loretech serve           # start MCP server (stdio transport)
 *
 * init:
 * 1. Creates .loretech/ in cwd (or ~/.loretech/ with --global)
 * 2. Prompts for OpenRouter + Exa API keys → .loretech/.env
 * 3. Creates .loretech/echoes/ + .loretech/runs/ for artifacts
 * 4. Installs SKILL.md into agent directories
 * 5. Registers MCP server in Claude Desktop config
 * 6. Adds .loretech/.env to .gitignore
 *
 * serve:
 * Starts the Loretech MCP server on stdio transport.
 * Host agents (Claude Desktop, Cursor) start this automatically.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const isGlobal = process.argv.includes("--global");

/**
 * Resolve the .loretech directory.
 *
 * --global → ~/.loretech/
 * default  → .loretech/ in cwd
 */
function resolveLoretech(): string {
  if (isGlobal) return path.join(HOME, ".loretech");
  return path.join(process.cwd(), ".loretech");
}

/**
 * Find .loretech config by walking up from cwd.
 * Resolution order: cwd → git root → home.
 */
export function findLoretechDir(): string {
  // 1. Check cwd
  const cwdDir = path.join(process.cwd(), ".loretech");
  if (fs.existsSync(path.join(cwdDir, ".env"))) return cwdDir;

  // 2. Walk up to git root
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
    const candidate = path.join(dir, ".loretech");
    if (fs.existsSync(path.join(candidate, ".env"))) return candidate;
    // Stop at git root
    if (fs.existsSync(path.join(dir, ".git"))) break;
  }

  // 3. Fall back to home
  return path.join(HOME, ".loretech");
}

// Agent directories that use SKILL.md natively
// .codex is symlinked to .claude (DRY — single source of truth)
const SKILL_MD_PRIMARY = ".claude/skills/loretech";
const SKILL_MD_SYMLINK = ".codex/skills/loretech";

// Agents that use their own rules format — we generate a rules file from SKILL.md
const RULES_TARGETS: Array<{
  dir: string;
  file: string;
  format: "mdc" | "md";
  label: string;
}> = [
  { dir: ".cursor/rules", file: "loretech.mdc", format: "mdc", label: "Cursor" },
  { dir: ".windsurf/rules", file: "loretech.md", format: "md", label: "Windsurf" },
];

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  execFile(cmd, [url], () => {});
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Generate a rules file from SKILL.md for agents that use their own format.
 */
function generateRulesFile(skillMd: string, format: "mdc" | "md"): string {
  const body = skillMd.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

  if (format === "mdc") {
    return `---
description: LORETECH conversation materializer — creates Echoes from conversation context
globs:
alwaysApply: true
---

# LORETECH Skill

${body}
`;
  }

  return `# LORETECH Skill

${body}
`;
}

/**
 * Add .loretech/.env to .gitignore if not already present.
 */
function ensureGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const entry = ".loretech/.env";

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (content.includes(entry)) return;
    fs.appendFileSync(gitignorePath, `\n${entry}\n`, "utf-8");
  } else {
    fs.writeFileSync(gitignorePath, `${entry}\n`, "utf-8");
  }
}

async function main() {
  const loretechDir = resolveLoretech();
  const scope = isGlobal ? "global (~/.loretech)" : "project (.loretech/)";

  console.log();
  console.log("  ╔══════════════════════════════════╗");
  console.log("  ║         LORETECH  INSTALL         ║");
  console.log("  ╚══════════════════════════════════╝");
  console.log();
  console.log("  LORETECH materializes conversation into living artifacts (Echoes).");
  console.log("  Context in, persistent enriched artifact out — shareable at a URL.");
  console.log();
  console.log(`  Installing to: ${scope}`);
  console.log();
  console.log("  You need two API keys (your keys, your cost):");
  console.log("  • OpenRouter — for inference (openrouter.ai/keys)");
  console.log("  • Exa        — for deep research (dashboard.exa.ai)");
  console.log();

  // ── Check for existing config ────────────────────────────────────────
  fs.mkdirSync(loretechDir, { recursive: true });
  const envFile = path.join(loretechDir, ".env");
  const existingEnv: Record<string, string> = {};

  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) existingEnv[match[1]] = match[2];
    }
    console.log(`  Found existing config at ${envFile}`);
    console.log();
  }

  // ── Prompt for keys ──────────────────────────────────────────────────
  const openrouterKey =
    existingEnv.OPENROUTER_API_KEY ||
    (await prompt("  OpenRouter API key: "));

  const exaKey =
    existingEnv.EXA_API_KEY ||
    (await prompt("  Exa API key:        "));

  if (!openrouterKey || !exaKey) {
    console.error("\n  Both keys are required. Aborting.");
    process.exit(1);
  }

  // ── Provision Loretech API key ──────────────────────────────────────
  const LORETECH_API = "https://loretech.archive.energy";
  let loretechKey = existingEnv.LORETECH_API_KEY ?? "";

  if (!loretechKey) {
    console.log();
    console.log("  Provisioning Loretech API key...");
    try {
      const res = await fetch(`${LORETECH_API}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { apiKey?: string; checkoutUrl?: string };

      if (data.apiKey) {
        loretechKey = data.apiKey;
        console.log("  ✓ API key provisioned");
      } else if (data.checkoutUrl) {
        console.log("  Opening payment page...");
        openBrowser(data.checkoutUrl);
        console.log();
        console.log("  Complete checkout, then re-run: bunx loretech init");
        console.log("  Your API key will be issued after payment.");
        process.exit(0);
      } else {
        console.error("  ⚠ Could not provision API key. Add LORETECH_API_KEY manually to .loretech/.env");
      }
    } catch {
      console.error("  ⚠ Could not reach loretech service. Add LORETECH_API_KEY manually to .loretech/.env");
    }
  }

  // ── Write config ─────────────────────────────────────────────────────
  const envLines = [
    `OPENROUTER_API_KEY=${openrouterKey}`,
    `EXA_API_KEY=${exaKey}`,
  ];
  if (loretechKey) {
    envLines.push(`LORETECH_API_KEY=${loretechKey}`);
  }
  envLines.push("");
  const envContent = envLines.join("\n");

  fs.writeFileSync(envFile, envContent, "utf-8");
  console.log();
  console.log(`  ✓ Keys saved to ${envFile}`);

  // ── Create echoes + runs directories ─────────────────────────────────
  fs.mkdirSync(path.join(loretechDir, "echoes"), { recursive: true });
  fs.mkdirSync(path.join(loretechDir, "runs"), { recursive: true });
  console.log(`  ✓ Echo directory ready at ${path.join(loretechDir, "echoes")}`);
  console.log(`  ✓ Runs directory ready at ${path.join(loretechDir, "runs")}`);

  // ── Add .env to .gitignore (project-level only) ─────────────────────
  if (!isGlobal) {
    ensureGitignore(process.cwd());
    console.log("  ✓ Added .loretech/.env to .gitignore");
  }

  // ── Install skill into agent directories ─────────────────────────────
  const skillSrc = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
  const cwd = process.cwd();
  const installedTo: string[] = [];

  const skillMdPath = path.join(skillSrc, "SKILL.md");
  const skillMdContent = fs.existsSync(skillMdPath)
    ? fs.readFileSync(skillMdPath, "utf-8")
    : "";

  // 1. Install to .claude (primary)
  const primaryDest = path.join(cwd, SKILL_MD_PRIMARY);
  try {
    fs.mkdirSync(primaryDest, { recursive: true });

    if (skillMdContent) {
      fs.writeFileSync(path.join(primaryDest, "SKILL.md"), skillMdContent, "utf-8");
    }

    const refSrc = path.join(skillSrc, "references");
    if (fs.existsSync(refSrc)) {
      copyDir(refSrc, path.join(primaryDest, "references"));
    }

    installedTo.push(SKILL_MD_PRIMARY);
  } catch (err) {
    console.warn(`  ⚠ Could not install to ${SKILL_MD_PRIMARY}: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Symlink .codex → .claude (avoid duplication)
  const symlinkDest = path.join(cwd, SKILL_MD_SYMLINK);
  try {
    // Ensure parent dir exists
    fs.mkdirSync(path.dirname(symlinkDest), { recursive: true });
    // Remove existing if it's not already correct
    if (fs.existsSync(symlinkDest)) {
      const stat = fs.lstatSync(symlinkDest);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(symlinkDest);
      } else {
        fs.rmSync(symlinkDest, { recursive: true });
      }
    }
    // Relative symlink from .codex/skills/loretech → ../../.claude/skills/loretech
    fs.symlinkSync(
      path.relative(path.dirname(symlinkDest), primaryDest),
      symlinkDest,
    );
    installedTo.push(`${SKILL_MD_SYMLINK} → ${SKILL_MD_PRIMARY}`);
  } catch (err) {
    console.warn(`  ⚠ Could not symlink ${SKILL_MD_SYMLINK}: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Rules-format agents (Cursor, Windsurf)
  for (const { dir, file, format, label } of RULES_TARGETS) {
    const dest = path.join(cwd, dir);
    try {
      fs.mkdirSync(dest, { recursive: true });

      const rulesContent = generateRulesFile(skillMdContent, format);
      fs.writeFileSync(path.join(dest, file), rulesContent, "utf-8");

      installedTo.push(`${dir}/${file} (${label})`);
    } catch (err) {
      console.warn(`  ⚠ Could not install ${label} rules: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log();
  if (installedTo.length) {
    for (const t of installedTo) {
      console.log(`  ✓ Installed to ${t}`);
    }
  } else {
    console.log("  ℹ No agent directories detected — skill files will be");
    console.log("    installed when you run this from a project directory.");
  }

  // ── Register MCP server in Claude Desktop config ─────────────────────
  registerMcpConfig();

  // ── Done ─────────────────────────────────────────────────────────────
  const envLabel = isGlobal ? "~/.loretech/.env" : ".loretech/.env";
  console.log();
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log("  │                                                 │");
  console.log("  │  LORETECH installed.                            │");
  console.log("  │                                                 │");
  console.log("  │  MCP server registered — your agent now has:    │");
  console.log("  │  • loretech_echo     Materialize echoes          │");
  console.log("  │  • loretech_runs     List pipeline runs         │");
  console.log("  │  • loretech_inspect  Read run artifacts         │");
  console.log("  │  • loretech_rerun    Replay from any step       │");
  console.log("  │                                                 │");
  console.log(`  │  Keys: ${envLabel.padEnd(40)}│`);
  console.log(`  │  API key: ${loretechKey ? "✓ provisioned" : "⚠ missing"}                           │`);
  console.log("  │                                                 │");
  console.log("  │  Runs materialize at: .loretech/runs/{id}/      │");
  console.log("  │  Echoes saved to:     .loretech/echoes/{id}.md  │");
  console.log("  │                                                 │");
  console.log("  └─────────────────────────────────────────────────┘");
  console.log();

  openBrowser("https://loretech.archive.energy/feed");
}

/**
 * Register the Loretech MCP server in Claude Desktop's config.
 * Creates/updates ~/Library/Application Support/Claude/claude_desktop_config.json
 */
function registerMcpConfig(): void {
  const configPaths: string[] = [];

  // Claude Desktop
  if (process.platform === "darwin") {
    configPaths.push(
      path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    );
  } else if (process.platform === "win32") {
    configPaths.push(
      path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json"),
    );
  } else {
    configPaths.push(
      path.join(HOME, ".config", "claude", "claude_desktop_config.json"),
    );
  }

  for (const configPath of configPaths) {
    try {
      const configDir = path.dirname(configPath);
      fs.mkdirSync(configDir, { recursive: true });

      let config: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }

      const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
      mcpServers.loretech = {
        command: "bunx",
        args: ["loretech", "serve"],
      };
      config.mcpServers = mcpServers;

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`  ✓ MCP server registered in ${configPath}`);
    } catch (err) {
      console.warn(`  ⚠ Could not register MCP config at ${configPath}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI Router
// ---------------------------------------------------------------------------

const command = process.argv[2];

if (command === "serve") {
  // Start MCP server (stdio transport)
  import("./src/server.js")
    .then((mod) => mod.startServer())
    .catch((err) => {
      console.error("Failed to start MCP server:", err);
      process.exit(1);
    });
} else {
  // Default: run installer (handles both "init" and no-arg)
  main();
}
