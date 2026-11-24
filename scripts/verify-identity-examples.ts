// Builds every Identity example in src/identity/code.ts and runs those marked "run", comparing their output with the
// example's stated output. Run: node --experimental-strip-types scripts/verify-identity-examples.ts [csharp|java|python …]
//
// Needs: .NET 10 SDK (file-based apps with #:sdk / #:package), JDK 17+ and Maven (Spring Boot 4.2 projects are generated
// in a temporary folder), Python 3 (a temporary virtual environment gets the listed packages). Packages are
// downloaded from NuGet, Maven Central and PyPI. A missing toolchain is reported as NOT VERIFIED, never as passed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { identityExamples, type IdentityExample } from "../src/identity/code.ts";

const windows = process.platform === "win32";
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", shell: windows }).status === 0;
const python = has("python3", ["--version"]) ? ["python3"] : has("py", ["-3", "--version"]) ? ["py", "-3"] : null;
const available = { csharp: has("dotnet", ["--version"]), java: has("java", ["-version"]) && has("mvn", ["-v"]), python: !!python };
const root = mkdtempSync(join(tmpdir(), "kitab-identity-examples-"));
const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
const exec = (cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000, shell: windows && (cmd === "mvn" || cmd === "py"), env: { ...process.env, ...env } });

let venvPython: string | null = null;
function pythonEnv() {
  if (venvPython) return venvPython;
  const venv = join(root, "venv");
  exec(python![0], [...python!.slice(1), "-m", "venv", venv], root);
  venvPython = join(venv, windows ? "Scripts/python.exe" : "bin/python");
  exec(venvPython, ["-m", "pip", "install", "-q", "fastapi==0.165.0", "pyjwt[crypto]==2.15.1", "httpx", "authlib==1.9.10", "itsdangerous"], root);
  return venvPython;
}

const pom = (deps: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.2.0</version><relativePath/></parent>
  <groupId>example</groupId><artifactId>identity-example</artifactId><version>1.0</version>
  <properties><java.version>17</java.version></properties>
  <dependencies>
${deps.map((d) => { const [g, a] = d.split(" ")[0].split(":"); return `    <dependency><groupId>${g}</groupId><artifactId>${a}</artifactId></dependency>`; }).join("\n")}
  </dependencies>
</project>`;

function verify(e: IdentityExample): string {
  const dir = join(root, e.id);
  mkdirSync(dir, { recursive: true });
  if (e.lang === "csharp") {
    writeFileSync(join(dir, "Program.cs"), e.source + "\n");
    exec("dotnet", ["build", "Program.cs", "-nologo", "-v", "q"], dir);
    return e.verify === "run" ? exec("dotnet", ["run", "--no-build", "Program.cs"], dir) : "";
  }
  if (e.lang === "java") {
    const className = /public class (\w+)/.exec(e.source)![1];
    if (!e.deps.length) {
      writeFileSync(join(dir, `${className}.java`), e.source + "\n");
      return exec("java", [`${className}.java`], dir);
    }
    const pkg = /^package ([\w.]+);/m.exec(e.source)?.[1] ?? "";
    const source = join(dir, "src/main/java", ...pkg.split("."), `${className}.java`);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, e.source + "\n");
    for (const x of e.extra ?? []) {
      mkdirSync(dirname(join(dir, x.file)), { recursive: true });
      writeFileSync(join(dir, x.file), x.source + "\n");
    }
    writeFileSync(join(dir, "pom.xml"), pom(e.deps));
    exec("mvn", ["-q", "-B", "compile", "dependency:build-classpath", "-Dmdep.outputFile=cp.txt"], dir);
    if (e.verify !== "run") return "";
    const cp = `target/classes${windows ? ";" : ":"}${execFileSync(windows ? "cmd" : "cat", windows ? ["/c", "type", "cp.txt"] : ["cp.txt"], { cwd: dir, encoding: "utf8" }).trim()}`;
    return exec("java", ["-cp", cp, `${pkg ? `${pkg}.` : ""}${className}`], dir);
  }
  const file = join(dir, "example.py");
  writeFileSync(file, e.source + "\n");
  const py = e.deps.length ? pythonEnv() : python![0];
  const pre = e.deps.length ? [] : python!.slice(1);
  if (e.verify === "run") return exec(py, [...pre, "-I", file], dir);
  exec(py, [...pre, "-m", "py_compile", file], dir);
  // Import it (module-level setup only; nothing is called), with placeholder settings it reads from the environment.
  if (e.deps.length) exec(py, ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(dir)}); import example`], dir, { SESSION_SECRET: "verification-only-not-a-secret", CLIENT_SECRET: "verification-only-not-a-secret" });
  return "";
}

const only = process.argv.slice(2);
let failed = 0;
let unverified = 0;
for (const e of identityExamples) {
  if (only.length && !only.includes(e.lang)) continue;
  if (!available[e.lang]) {
    unverified++;
    console.log(`NOT VERIFIED  ${e.lang.padEnd(6)} ${e.id} (no ${e.lang} toolchain)`);
    continue;
  }
  try {
    const out = verify(e);
    if (e.verify === "run" && normalize(out) !== normalize(e.output!)) {
      failed++;
      console.log(`WRONG OUTPUT  ${e.lang.padEnd(6)} ${e.id}\n--- expected\n${e.output}\n--- actual\n${normalize(out)}`);
    } else console.log(`ok            ${e.lang.padEnd(6)} ${e.id} (${e.verify === "run" ? "built, ran, output matches" : "built"})`);
  } catch (error) {
    failed++;
    const x = error as { stdout?: string; stderr?: string; message: string };
    console.log(`FAIL          ${e.lang.padEnd(6)} ${e.id}\n${((x.stdout ?? "") + (x.stderr ?? x.message)).slice(-4000)}`);
  }
}
const version = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8", shell: windows }); return (r.stdout + r.stderr).trim().split("\n")[0]; };
console.log(`dotnet: ${available.csharp ? version("dotnet", ["--version"]) : "not available"}`);
console.log(`java: ${available.java ? `${version("java", ["-version"])}; ${version("mvn", ["-v"])}` : "not available"}`);
console.log(`python: ${python ? version(python[0], [...python.slice(1), "--version"]) : "not available"}`);
console.log(`${failed} failed, ${unverified} not verified`);
process.exit(failed ? 1 : 0);
