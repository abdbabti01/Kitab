// The browser's loading boundary: Lesson 2's engine and scene load on demand; the Worker and tests register every engine.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineIds } from "../src/learning/registry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

test("one list of engines: the browser's eager set plus its on-demand set is exactly what the Worker registers", async () => {
  const { onDemandEngines, loadEngine } = await import("../src/learning/engines/browser.ts");
  const eager = engineIds();
  assert.deepEqual(Object.keys(onDemandEngines), ["local-delivery"]);
  assert.ok(!eager.includes("local-delivery"), "Lesson 2's engine is not registered until a page asks for it");
  await loadEngine("local-delivery");
  assert.ok(engineIds().includes("local-delivery"));
  await import("../src/learning/engines/index.ts");
  assert.deepEqual(new Set(engineIds()), new Set([...eager, ...Object.keys(onDemandEngines)]));
  // Every on-demand engine has an on-demand scene, and nothing else is on demand.
  const scenes = source("src/mission/scenes/index.ts");
  const onDemandScenes = scenes.slice(scenes.indexOf("onDemandScenes"));
  assert.deepEqual([...onDemandScenes.matchAll(onDemandEntry)].map((m) => m[1]), Object.keys(onDemandEngines));
});

test("the Worker keeps registering every engine synchronously", () => {
  for (const file of ["worker/compose.ts", "worker/lesson-tutor.ts", "worker/tutor.ts"]) assert.match(source(file), /import "\.\.\/src\/learning\/engines\/index\.ts";/, file);
});

const staticImport = /^\s*(?:import|export)\s(?:[^;"]*?\sfrom\s)?"(\.[^"]+)"/gm;
const onDemandEntry = /^\s+"([\w-]+)": \(\) => import\(/gm;
/** Files reachable through static imports (dynamic import() is the on-demand boundary and is not followed). */
function staticGraph(entry: string) {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of readFileSync(file, "utf8").matchAll(staticImport)) {
      const target = resolve(dirname(file), spec);
      if (/\.(tsx?)$/.test(target) && existsSync(target)) visit(target);
    }
  };
  visit(resolve(root, entry));
  return [...seen].map((file) => file.slice(root.length + 1).replace(/\\/g, "/"));
}

test("existing lesson and mission pages do not statically import Lesson 2's engine or scene", () => {
  for (const page of ["src/lesson/LessonPage.tsx", "src/mission/MissionPage.tsx"]) {
    const graph = staticGraph(page);
    assert.ok(graph.includes("src/learning/engines/eager.ts"), `${page} reaches the eager engines`);
    for (const file of ["src/learning/engines/local-delivery.ts", "src/mission/scenes/LocalDeliveryScene.tsx"]) {
      assert.ok(!graph.includes(file), `${page} must not statically import ${file}`);
    }
  }
  // (The lab simulator is reachable through the networking path on main too, but no code there uses it, so the bundler drops it;
  // the built-page measurement in the PR checks real download sizes.) The Worker's registry does reach Lesson 2's engine.
  assert.ok(staticGraph("src/learning/engines/index.ts").includes("src/learning/engines/local-delivery.ts"));
});
