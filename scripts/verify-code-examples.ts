// Compiles and runs every C#, Java and Python example in src/structures/guide/code.ts and compares what it prints
// with the example's stated output. Run: node --experimental-strip-types scripts/verify-code-examples.ts [lang…]
//
// Needs: .NET 10 SDK (`dotnet run file.cs`), JDK 11+ (`java File.java`), Python 3 (`python3`, or `py -3` on Windows).
// A missing toolchain is reported as NOT VERIFIED, never as passed. Exit code 1 on any mismatch or failure.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allExamples } from "../src/structures/guide/code.ts";
import type { Lang } from "../src/structures/guide/content.ts";

const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", shell: false }).status === 0;
const python = has("python3", ["--version"]) ? ["python3"] : has("py", ["-3", "--version"]) ? ["py", "-3"] : null;
const runners: Record<Lang, { ext: string; available: boolean; version: string; run: (file: string, dir: string) => string[] }> = {
  csharp: { ext: "cs", available: has("dotnet", ["--version"]) && /^1\d\./.test(spawnSync("dotnet", ["--version"], { encoding: "utf8" }).stdout), version: "", run: (file) => ["dotnet", "run", "--no-build", file] },
  java: { ext: "java", available: has("java", ["-version"]), version: "", run: (file) => ["java", file] },
  python: { ext: "py", available: !!python, version: "", run: (file) => [...python!, "-I", file] },
};
const versionOf = (cmd: string[]) => {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  return (r.stdout + r.stderr).trim().split("\n")[0];
};
if (runners.csharp.available) runners.csharp.version = `dotnet ${versionOf(["dotnet", "--version"])}`;
if (runners.java.available) runners.java.version = versionOf(["java", "-version"]);
if (runners.python.available) runners.python.version = versionOf([...python!, "--version"]);

const only = process.argv.slice(2) as Lang[];
const root = mkdtempSync(join(tmpdir(), "kitab-examples-"));
const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
let failed = 0;
let unverified = 0;

for (const { guide, lang, example } of allExamples()) {
  if (only.length && !only.includes(lang)) continue;
  const runner = runners[lang];
  if (!runner.available) {
    unverified += 1;
    console.log(`NOT VERIFIED  ${lang.padEnd(6)} ${example.id} (no ${lang} toolchain)`);
    continue;
  }
  // One directory per example: dotnet run file.cs builds next to the file; java needs the file named after its class.
  const dir = join(root, example.id);
  mkdirSync(dir, { recursive: true });
  const className = /public class (\w+)/.exec(example.source)?.[1];
  const file = join(dir, `${lang === "java" && className ? className : "Program"}.${runner.ext}`);
  writeFileSync(file, example.source + "\n");
  const [cmd, ...args] = runner.run(file, dir);
  let stdout = "";
  try {
    // Build first, so restore and build messages never mix with the program's output.
    if (lang === "csharp") execFileSync("dotnet", ["build", file, "-nologo", "-v", "q"], { cwd: dir, stdio: "ignore", timeout: 180_000 });
    stdout = execFileSync(cmd, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
  } catch (error) {
    failed += 1;
    const e = error as { stdout?: string; stderr?: string; message: string };
    console.log(`FAIL          ${lang.padEnd(6)} ${example.id} (${guide})\n${(e.stdout ?? "") + (e.stderr ?? e.message)}`);
    continue;
  }
  if (normalize(stdout) !== normalize(example.output)) {
    failed += 1;
    console.log(`WRONG OUTPUT  ${lang.padEnd(6)} ${example.id}\n--- expected\n${example.output}\n--- actual\n${normalize(stdout)}`);
  } else console.log(`ok            ${lang.padEnd(6)} ${example.id}`);
}

for (const [lang, runner] of Object.entries(runners)) console.log(`${lang}: ${runner.available ? runner.version : "not available"}`);
console.log(`${failed} failed, ${unverified} not verified`);
process.exit(failed ? 1 : 0);
