/**
 * Run directory manager — .loretech/runs/{runId}/
 *
 * Each echo run gets a sandbox directory where artifacts materialize
 * step by step. User can watch, inspect, and replay from any step.
 *
 * Artifacts:
 *   context.json     — raw input + recalled memory
 *   sources.json     — research results
 *   echo.md          — composed echo
 *   meta.json        — run metadata (timing, status, steps)
 *   dataset.json     — webset data (when available)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findLoretechDir } from "./memory.js";

export interface RunMeta {
  runId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  steps: StepMeta[];
  echoId?: string;
  error?: string;
}

export interface StepMeta {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  artifact?: string; // filename written
}

const STEPS = [
  "context",
  "sources",
  "compose",
  "store",
  "record",
  "webset",
] as const;

export type StepName = (typeof STEPS)[number];

function runsDir(): string {
  return path.join(findLoretechDir(), "runs");
}

function runDir(runId: string): string {
  return path.join(runsDir(), runId);
}

/** Create a new run directory and initialize meta.json. */
export function createRun(runId: string): RunMeta {
  const dir = runDir(runId);
  fs.mkdirSync(dir, { recursive: true });

  const meta: RunMeta = {
    runId,
    status: "running",
    startedAt: new Date().toISOString(),
    steps: STEPS.map((name) => ({ name, status: "pending" })),
  };

  writeMeta(runId, meta);
  return meta;
}

/** Write an artifact file to the run directory. */
export function writeArtifact(
  runId: string,
  filename: string,
  content: string,
): string {
  const filepath = path.join(runDir(runId), filename);
  fs.writeFileSync(filepath, content, "utf-8");
  return filepath;
}

/** Read an artifact file from a run directory. */
export function readArtifact(runId: string, filename: string): string | null {
  const filepath = path.join(runDir(runId), filename);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

/** List all artifact files in a run directory. */
export function listArtifacts(runId: string): string[] {
  const dir = runDir(runId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

/** Update step status and optionally record the artifact filename. */
export function updateStep(
  runId: string,
  stepName: string,
  status: StepMeta["status"],
  artifact?: string,
): void {
  const meta = readMeta(runId);
  if (!meta) return;

  const step = meta.steps.find((s) => s.name === stepName);
  if (!step) return;

  step.status = status;
  if (status === "running") step.startedAt = new Date().toISOString();
  if (status === "completed" || status === "failed")
    step.completedAt = new Date().toISOString();
  if (artifact) step.artifact = artifact;

  writeMeta(runId, meta);
}

/** Mark the run as completed or failed. */
export function completeRun(
  runId: string,
  result: { echoId?: string; error?: string },
): void {
  const meta = readMeta(runId);
  if (!meta) return;

  meta.status = result.error ? "failed" : "completed";
  meta.completedAt = new Date().toISOString();
  if (result.echoId) meta.echoId = result.echoId;
  if (result.error) meta.error = result.error;

  writeMeta(runId, meta);
}

/** Read meta.json for a run. */
export function readMeta(runId: string): RunMeta | null {
  const filepath = path.join(runDir(runId), "meta.json");
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function writeMeta(runId: string, meta: RunMeta): void {
  const filepath = path.join(runDir(runId), "meta.json");
  fs.writeFileSync(filepath, JSON.stringify(meta, null, 2), "utf-8");
}

/** List all runs, newest first. */
export function listRuns(limit = 20): RunMeta[] {
  const dir = runsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const runs: RunMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readMeta(entry.name);
    if (meta) runs.push(meta);
  }

  return runs
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}
