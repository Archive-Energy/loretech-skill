import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loretech-test-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
  // Create .loretech dir in the tmp "project"
  fs.mkdirSync(path.join(tmpDir, ".loretech", "echoes"), { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeEchoRef / readEchoRefs", () => {
  it("writes and reads back echo references with full markdown", async () => {
    const mod = await import("./memory");

    mod.writeEchoRef({
      echoId: "echo-test123",
      privateKey: "pk_abc123",
      title: "Test Echo Title",
      status: "draft",
      createdAt: "2026-02-26T00:00:00Z",
      updatedAt: "2026-02-26T00:00:00Z",
      markdown: "# Test Echo\n\nThis is the body.",
    });

    const file = path.join(tmpDir, ".loretech", "echoes", "echo-test123.md");
    expect(fs.existsSync(file)).toBe(true);

    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("echoId: echo-test123");
    expect(content).toContain("privateKey: pk_abc123");
    expect(content).toContain("# Test Echo");
    expect(content).toContain("This is the body.");

    const refs = mod.readEchoRefs();
    expect(refs).toHaveLength(1);
    expect(refs[0].echoId).toBe("echo-test123");
    expect(refs[0].privateKey).toBe("pk_abc123");
    expect(refs[0].title).toBe("Test Echo Title");
    expect(refs[0].markdown).toContain("# Test Echo");
  });

  it("handles title with quotes", async () => {
    const mod = await import("./memory");

    mod.writeEchoRef({
      echoId: "echo-quotes",
      privateKey: "pk_xyz",
      title: 'Title with "quotes" inside',
      status: "published",
      createdAt: "2026-02-26T00:00:00Z",
      updatedAt: "2026-02-26T00:00:00Z",
      markdown: "",
    });

    const refs = mod.readEchoRefs();
    const ref = refs.find((r) => r.echoId === "echo-quotes");
    expect(ref).toBeDefined();
    expect(ref!.title).toContain("quotes");
  });

  it("writes companion .json dataset file", async () => {
    const mod = await import("./memory");

    const dataset = { items: [{ type: "article", url: "https://example.com" }] };
    mod.writeEchoRef(
      {
        echoId: "echo-dataset",
        privateKey: "pk_ds",
        title: "Dataset Echo",
        status: "draft",
        createdAt: "2026-02-27T00:00:00Z",
        updatedAt: "2026-02-27T00:00:00Z",
        markdown: "# With Dataset",
      },
      dataset,
    );

    const jsonFile = path.join(tmpDir, ".loretech", "echoes", "echo-dataset.json");
    expect(fs.existsSync(jsonFile)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    expect(parsed.items[0].type).toBe("article");

    const mdContent = fs.readFileSync(
      path.join(tmpDir, ".loretech", "echoes", "echo-dataset.md"),
      "utf-8",
    );
    expect(mdContent).toContain("[[echo-dataset.json]]");

    const refs = mod.readEchoRefs();
    const ref = refs.find((r) => r.echoId === "echo-dataset");
    expect(ref?.jsonPath).toBeDefined();
  });

  it("resolves project-level .loretech over global", async () => {
    const mod = await import("./memory");

    // findLoretechDir should find the cwd/.loretech we created
    const dir = fs.realpathSync(mod.findLoretechDir());
    const expected = fs.realpathSync(path.join(tmpDir, ".loretech"));
    expect(dir).toBe(expected);
  });
});
