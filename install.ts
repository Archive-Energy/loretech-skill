#!/usr/bin/env bun

/**
 * LORETECH CLI
 *
 * Usage:
 *   bunx loretech              # onboard (or start server if already installed)
 *   bunx loretech --global     # global install (~/.loretech/)
 *   bunx loretech serve        # start MCP server (stdio transport)
 *
 * Onboarding:
 * 1. Prompts: project location → display name → API keys → provision key → verify X (optional)
 * 2. Creates .loretech/.env (gitignored) + echoes/ + runs/
 * 3. Installs SKILL.md into agent directories
 * 4. Registers MCP server in Claude Desktop config
 *
 * If already installed (cwd has .loretech/.env), starts the MCP server.
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
  console.log();
  console.log("  ██╗      ██████╗ ██████╗ ███████╗████████╗███████╗ ██████╗██╗  ██╗");
  console.log("  ██║     ██╔═══██╗██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔════╝██║  ██║");
  console.log("  ██║     ██║   ██║██████╔╝█████╗     ██║   █████╗  ██║     ███████║");
  console.log("  ██║     ██║   ██║██╔══██╗██╔══╝     ██║   ██╔══╝  ██║     ██╔══██║");
  console.log("  ███████╗╚██████╔╝██║  ██║███████╗   ██║   ███████╗╚██████╗██║  ██║");
  console.log("  ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝");
  console.log();
  console.log("  Materialize conversation into living artifacts (Echoes).");
  console.log("  Context in, persistent enriched artifact out — shareable at a URL.");
  console.log();

  // ── Project location ─────────────────────────────────────────────────
  let projectDir: string;
  if (isGlobal) {
    projectDir = HOME;
  } else {
    const locationInput = await prompt(`  Where should we set up? (${process.cwd()}): `);
    projectDir = locationInput
      ? path.resolve(locationInput.replace(/^~/, HOME))
      : process.cwd();
  }

  const loretechDir = isGlobal
    ? path.join(HOME, ".loretech")
    : path.join(projectDir, ".loretech");

  const scope = isGlobal ? "global (~/.loretech)" : loretechDir;
  console.log(`  → ${scope}`);
  console.log();

  // ── Check for existing config ────────────────────────────────────────
  fs.mkdirSync(projectDir, { recursive: true });
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

  // ── Display name ────────────────────────────────────────────────────
  const displayName =
    existingEnv.DISPLAY_NAME ||
    (await prompt("  Display name: "));

  console.log();

  // ── Prompt for keys ──────────────────────────────────────────────────
  console.log("  You need two API keys (your keys, your cost):");
  console.log("  • OpenRouter — for inference (openrouter.ai/keys)");
  console.log("  • Exa        — for deep research (dashboard.exa.ai)");
  console.log();

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

  // ── Provision Loretech API key (before X verification — needed for tagging) ──
  const LORETECH_API = "https://fast-raspy-monitor.mastra.cloud";
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
        console.log("  Complete checkout, then re-run: bunx loretech");
        console.log("  Your API key will be issued after payment.");
        process.exit(0);
      } else {
        console.error("  ⚠ Could not provision API key. Add LORETECH_API_KEY manually to .loretech/.env");
      }
    } catch {
      console.error("  ⚠ Could not reach loretech service. Add LORETECH_API_KEY manually to .loretech/.env");
    }
  }

  // ── Verify X account (optional — requires loretech key) ─────────────
  let xHandle = existingEnv.X_HANDLE || "";

  if (!xHandle && loretechKey) {
    console.log();
    const verifyX = await prompt("  Verify X account? [y/N]: ");
    if (verifyX.toLowerCase() === "y") {
      try {
        const startRes = await fetch(`${LORETECH_API}/auth/x/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Loretech-Key": loretechKey,
          },
        });

        if (startRes.ok) {
          const { url, state } = await startRes.json() as { url: string; state: string };
          openBrowser(url);
          process.stdout.write("  Waiting for verification...");

          // Poll for result (2s interval, 5 min timeout)
          let verified = false;
          for (let i = 0; i < 150; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const statusRes = await fetch(`${LORETECH_API}/auth/x/status?state=${state}`);
              const data = await statusRes.json() as { status: string; xHandle?: string };
              if (data.status === "verified" && data.xHandle) {
                xHandle = data.xHandle;
                console.log(` ✓ Verified as ${xHandle}`);
                verified = true;
                break;
              }
            } catch {
              // Network hiccup — keep polling
            }
          }

          if (!verified) {
            console.log(" timed out");
            console.log("  ⚠ Verification did not complete. You can retry later with: bunx loretech");
          }
        } else {
          const err = await startRes.json().catch(() => ({})) as { error?: string };
          if (startRes.status === 404) {
            console.log("  ℹ X verification not available on this engine (OAuth not configured)");
          } else {
            console.log(`  ⚠ Could not start X verification: ${err.error ?? startRes.statusText}`);
          }
        }
      } catch {
        console.log("  ⚠ Could not reach engine for X verification");
      }
    }
  }

  // ── Write config ─────────────────────────────────────────────────────
  const envLines: string[] = [];
  if (displayName) envLines.push(`DISPLAY_NAME=${displayName}`);
  if (xHandle) envLines.push(`X_HANDLE=${xHandle}`);
  envLines.push(
    `OPENROUTER_API_KEY=${openrouterKey}`,
    `EXA_API_KEY=${exaKey}`,
  );
  if (loretechKey) {
    envLines.push(`LORETECH_API_KEY=${loretechKey}`);
  }
  envLines.push("");
  const envContent = envLines.join("\n");

  fs.writeFileSync(envFile, envContent, "utf-8");
  console.log();
  console.log(`  ✓ Config saved to ${envFile}`);

  // ── Create echoes + runs directories ─────────────────────────────────
  fs.mkdirSync(path.join(loretechDir, "echoes"), { recursive: true });
  fs.mkdirSync(path.join(loretechDir, "runs"), { recursive: true });
  console.log(`  ✓ Echo directory ready at ${path.join(loretechDir, "echoes")}`);
  console.log(`  ✓ Runs directory ready at ${path.join(loretechDir, "runs")}`);

  // ── Add .env to .gitignore (project-level only) ─────────────────────
  if (!isGlobal) {
    ensureGitignore(projectDir);
    console.log("  ✓ Added .loretech/.env to .gitignore");
  }

  // ── Install skill into agent directories ─────────────────────────────
  const skillSrc = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
  const installedTo: string[] = [];

  const skillMdPath = path.join(skillSrc, "SKILL.md");
  const skillMdContent = fs.existsSync(skillMdPath)
    ? fs.readFileSync(skillMdPath, "utf-8")
    : "";

  const refSrc = path.join(skillSrc, "references");

  /**
   * Write SKILL.md + references to a destination directory.
   */
  function installSkillTo(dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    if (skillMdContent) {
      fs.writeFileSync(path.join(dest, "SKILL.md"), skillMdContent, "utf-8");
    }
    if (fs.existsSync(refSrc)) {
      copyDir(refSrc, path.join(dest, "references"));
    }
  }

  /**
   * Create a symlink at `link` pointing to `target`.
   * Only if the parent directory already exists (don't create harness dirs).
   */
  function symlinkSkill(link: string, target: string, label: string): void {
    if (!fs.existsSync(path.dirname(link))) return; // harness not installed
    try {
      if (fs.existsSync(link)) {
        const stat = fs.lstatSync(link);
        if (stat.isSymbolicLink()) fs.unlinkSync(link);
        else fs.rmSync(link, { recursive: true });
      }
      fs.symlinkSync(
        path.relative(path.dirname(link), target),
        link,
      );
      installedTo.push(`${label} → global`);
    } catch (err) {
      console.warn(`  ⚠ Could not symlink ${label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 1. Global install: ~/.claude/skills/loretech/ (canonical — always)
  const globalSkillDir = path.join(HOME, SKILL_MD_PRIMARY);
  try {
    installSkillTo(globalSkillDir);
    installedTo.push(`~/${SKILL_MD_PRIMARY} (global)`);
  } catch (err) {
    console.warn(`  ⚠ Could not install global skill: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Project-level install (if not --global and projectDir != HOME)
  if (!isGlobal && projectDir !== HOME) {
    const projectSkillDir = path.join(projectDir, SKILL_MD_PRIMARY);
    try {
      installSkillTo(projectSkillDir);
      installedTo.push(SKILL_MD_PRIMARY);
    } catch (err) {
      console.warn(`  ⚠ Could not install to ${SKILL_MD_PRIMARY}: ${err instanceof Error ? err.message : err}`);
    }

    // Project-level symlinks for other harnesses
    symlinkSkill(
      path.join(projectDir, SKILL_MD_SYMLINK),
      path.join(projectDir, SKILL_MD_PRIMARY),
      SKILL_MD_SYMLINK,
    );
  }

  // 3. Global symlinks: Codex + OpenClaw → ~/.claude/skills/loretech/
  symlinkSkill(
    path.join(HOME, SKILL_MD_SYMLINK),
    globalSkillDir,
    `~/${SKILL_MD_SYMLINK}`,
  );
  // OpenClaw already has ~/.openclaw/skills → ~/.claude/skills (covers it),
  // but if that symlink is missing, create the specific skill link
  const openclawSkillDir = path.join(HOME, ".openclaw", "skills", "loretech");
  if (fs.existsSync(path.join(HOME, ".openclaw")) && !fs.existsSync(openclawSkillDir)) {
    const openclawSkillsDir = path.join(HOME, ".openclaw", "skills");
    if (!fs.existsSync(openclawSkillsDir) || !fs.lstatSync(openclawSkillsDir).isSymbolicLink()) {
      symlinkSkill(openclawSkillDir, globalSkillDir, "~/.openclaw/skills/loretech");
    }
  }

  // 4. Rules-format agents (Cursor, Windsurf) — project-level only
  if (!isGlobal && projectDir !== HOME) {
    for (const { dir, file, format, label } of RULES_TARGETS) {
      const dest = path.join(projectDir, dir);
      try {
        fs.mkdirSync(dest, { recursive: true });
        const rulesContent = generateRulesFile(skillMdContent, format);
        fs.writeFileSync(path.join(dest, file), rulesContent, "utf-8");
        installedTo.push(`${dir}/${file} (${label})`);
      } catch (err) {
        console.warn(`  ⚠ Could not install ${label} rules: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log();
  for (const t of installedTo) {
    console.log(`  ✓ Installed to ${t}`);
  }

  // ── Register MCP server with credentials in env block ────────────────
  const mcpEnvVars: Record<string, string> = {};
  if (loretechKey) mcpEnvVars.LORETECH_API_KEY = loretechKey;
  if (openrouterKey) mcpEnvVars.OPENROUTER_API_KEY = openrouterKey;
  if (exaKey) mcpEnvVars.EXA_API_KEY = exaKey;
  if (displayName) mcpEnvVars.DISPLAY_NAME = displayName;
  if (xHandle) mcpEnvVars.X_HANDLE = xHandle;
  registerMcpConfig(mcpEnvVars);

  // ── Done ─────────────────────────────────────────────────────────────
  const envLabel = isGlobal ? "~/.loretech/.env" : path.relative(process.cwd(), envFile) || ".loretech/.env";
  const cdHint = projectDir !== process.cwd()
    ? `  │  cd ${path.relative(process.cwd(), projectDir).padEnd(43)}│\n`
    : "";
  console.log();
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log("  │                                                 │");
  console.log("  │  LORETECH installed.                            │");
  console.log("  │                                                 │");
  console.log("  │  MCP server registered — your agent now has:    │");
  console.log("  │  • loretech_echo     Materialize echoes         │");
  console.log("  │  • loretech_runs     List pipeline runs         │");
  console.log("  │  • loretech_inspect  Read run artifacts         │");
  console.log("  │  • loretech_rerun    Replay from any step       │");
  console.log("  │                                                 │");
  console.log(`  │  Keys: ${envLabel.padEnd(40)}│`);
  console.log(`  │  API key: ${loretechKey ? "✓ provisioned" : "⚠ missing"}                           │`);
  console.log("  │                                                 │");
  if (cdHint) process.stdout.write(cdHint);
  console.log("  │  Then launch your agent: claude (or codex)      │");
  console.log("  │                                                 │");
  console.log("  └─────────────────────────────────────────────────┘");
  console.log();

  openBrowser("https://loretech.archive.energy");
}

/**
 * Register the Loretech MCP server in agent configs.
 * Writes credentials into the env block so the server always has them.
 */
function registerMcpConfig(envVars: Record<string, string>): void {
  const mcpEntry = {
    command: "bunx",
    args: ["loretech", "serve"],
    env: envVars,
  };

  // --- Claude Desktop ---
  const desktopConfigs: string[] = [];
  if (process.platform === "darwin") {
    desktopConfigs.push(
      path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    );
  } else if (process.platform === "win32") {
    desktopConfigs.push(
      path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json"),
    );
  } else {
    desktopConfigs.push(
      path.join(HOME, ".config", "claude", "claude_desktop_config.json"),
    );
  }

  for (const configPath of desktopConfigs) {
    try {
      const configDir = path.dirname(configPath);
      fs.mkdirSync(configDir, { recursive: true });

      let config: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }

      const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
      mcpServers.loretech = mcpEntry;
      config.mcpServers = mcpServers;

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`  ✓ MCP server registered in ${configPath}`);
    } catch (err) {
      console.warn(`  ⚠ Could not register MCP config at ${configPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // --- Claude Code (global settings) ---
  try {
    const claudeCodeConfig = path.join(HOME, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(claudeCodeConfig), { recursive: true });

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(claudeCodeConfig)) {
      settings = JSON.parse(fs.readFileSync(claudeCodeConfig, "utf-8"));
    }

    const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers.loretech = mcpEntry;
    settings.mcpServers = mcpServers;

    fs.writeFileSync(claudeCodeConfig, JSON.stringify(settings, null, 2), "utf-8");
    console.log(`  ✓ MCP server registered in ${claudeCodeConfig}`);
  } catch (err) {
    console.warn(`  ⚠ Could not register Claude Code config: ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// CLI Router
// ---------------------------------------------------------------------------

const command = process.argv[2];

if (command === "serve") {
  // Explicit serve command
  import("./src/server.js")
    .then((mod) => mod.startServer())
    .catch((err) => {
      console.error("Failed to start MCP server:", err);
      process.exit(1);
    });
} else {
  // Check if already installed — if so, start server instead of re-onboarding
  const cwdEnv = path.join(process.cwd(), ".loretech", ".env");
  if (!command && !isGlobal && fs.existsSync(cwdEnv)) {
    import("./src/server.js")
      .then((mod) => mod.startServer())
      .catch((err) => {
        console.error("Failed to start MCP server:", err);
        process.exit(1);
      });
  } else {
    main();
  }
}
