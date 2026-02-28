/**
 * Local echo file operations — .loretech/echoes/
 *
 * Each echo lives at .loretech/echoes/{id}.md as a standard markdown file
 * with YAML frontmatter (echoId, privateKey, title, status, timestamps)
 * followed by the full echo body. Overwritten on every update.
 *
 * Resolution order for .loretech/ directory:
 *   1. cwd/.loretech/
 *   2. Walk up to git root/.loretech/
 *   3. ~/.loretech/ (global fallback)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";

/**
 * Find .loretech directory by walking up from cwd.
 * Resolution: cwd → git root → home.
 */
export function findLoretechDir(): string {
  // 1. Check cwd
  const cwdDir = path.join(process.cwd(), ".loretech");
  if (fs.existsSync(cwdDir)) return cwdDir;

  // 2. Walk up to git root
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
    const candidate = path.join(dir, ".loretech");
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, ".git"))) break;
  }

  // 3. Fall back to home
  return path.join(HOME, ".loretech");
}

function echoesDir(): string {
  return path.join(findLoretechDir(), "echoes");
}

function ensureEchoesDir(): void {
  fs.mkdirSync(echoesDir(), { recursive: true });
}

// ---------------------------------------------------------------------------
// Echo references — persist full echo .md files locally so they're always
// accessible as plain files, even offline. Files > Apps.
// ---------------------------------------------------------------------------

export interface EchoRef {
  echoId: string;
  privateKey: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  markdown: string;
  /** Path to companion .json dataset file (if Webset completed) */
  jsonPath?: string;
}

/** Write or update a full echo file after POST /echo. */
export function writeEchoRef(ref: EchoRef, dataset?: unknown): void {
  ensureEchoesDir();
  const hasDataset = !!dataset;
  const dir = echoesDir();
  const frontmatter = [
    `---`,
    `echoId: ${ref.echoId}`,
    `privateKey: ${ref.privateKey}`,
    `title: "${ref.title.replace(/"/g, '\\"')}"`,
    `status: ${ref.status}`,
    `createdAt: ${ref.createdAt}`,
    `updatedAt: ${ref.updatedAt}`,
    ...(hasDataset ? [`dataset: "[[${ref.echoId}.json]]"`] : []),
    `---`,
  ].join("\n");
  const content = ref.markdown
    ? `${frontmatter}\n\n${ref.markdown}\n`
    : `${frontmatter}\n`;
  fs.writeFileSync(path.join(dir, `${ref.echoId}.md`), content, "utf-8");

  if (dataset) {
    const jsonPath = path.join(dir, `${ref.echoId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(dataset, null, 2), "utf-8");
  }
}

/** Read all local echo references (frontmatter + body). Returns newest first. */
export function readEchoRefs(): EchoRef[] {
  ensureEchoesDir();
  const dir = echoesDir();
  const refs: EchoRef[] = [];

  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const ref = parseEchoRef(content);
      if (!ref) continue;
      const jsonFile = path.join(dir, `${ref.echoId}.json`);
      if (fs.existsSync(jsonFile)) {
        ref.jsonPath = jsonFile;
      }
      refs.push(ref);
    }
  } catch {
    // empty
  }

  return refs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function parseEchoRef(content: string): EchoRef | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const get = (key: string): string => {
    const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match ? match[1].replace(/^"|"$/g, "").trim() : "";
  };

  const echoId = get("echoId");
  const privateKey = get("privateKey");
  if (!echoId || !privateKey) return null;

  const bodyStart = content.indexOf("---", 4);
  const markdown = bodyStart !== -1
    ? content.slice(content.indexOf("\n", bodyStart) + 1).trim()
    : "";

  return {
    echoId,
    privateKey,
    title: get("title"),
    status: get("status") || "draft",
    createdAt: get("createdAt"),
    updatedAt: get("updatedAt"),
    markdown,
  };
}
