import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readAvatarFile, writeAvatarFile, listAvatarFiles, getAvatarDirPath, buildSoulContext, SoulEngineError } from "../src/persona/soul-engine";

let base: string;
beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "soul-"));
  fs.mkdirSync(path.join(base, "_template"));
  fs.writeFileSync(path.join(base, "_template", "soul.md"), "# Template Soul");
  process.env.AVATAR_DATA_DIR = base;
});

describe("soul engine", () => {
  it("initialises from template and round-trips edits", async () => {
    expect(await readAvatarFile("avatar-1", "soul.md")).toBe("# Template Soul");
    await writeAvatarFile("avatar-1", "soul.md", "# New soul");
    expect(await readAvatarFile("avatar-1", "soul.md")).toBe("# New soul");
    const files = await listAvatarFiles("avatar-1");
    expect(files.map((f) => f.filename)).toEqual(["soul.md", "identity.md", "rules.md"]);
    expect(await buildSoulContext("avatar-1")).toContain("# New soul");
  });

  it.each(["../x", "a/b", "..", "_template", "a".repeat(65), ""])("rejects avatar id %j", (id) => {
    expect(() => getAvatarDirPath(id)).toThrow(SoulEngineError);
  });

  it.each(["../../etc/passwd", "soul.md/../../x", "/etc/passwd", "evil.md", "SOUL.MD", "soul.md\0"])("rejects filename %j", async (name) => {
    await expect(writeAvatarFile("avatar-1", name, "x")).rejects.toThrow(SoulEngineError);
    await expect(readAvatarFile("avatar-1", name)).rejects.toThrow(SoulEngineError);
  });

  it("rejects oversized content", async () => {
    await expect(writeAvatarFile("avatar-1", "rules.md", "x".repeat(300 * 1024))).rejects.toThrow(/too large/);
  });
});
