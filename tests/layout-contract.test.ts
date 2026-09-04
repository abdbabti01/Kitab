import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tcpCss = readFileSync(
  new URL("../src/visual-engine/tcp/tcp-reference.css", import.meta.url),
  "utf8",
);
const generatedCss = readFileSync(
  new URL("../src/visual-engine/generic/generated-lesson.css", import.meta.url),
  "utf8",
);
const tcpComponent = readFileSync(
  new URL("../src/visual-engine/tcp/TcpReferenceLesson.tsx", import.meta.url),
  "utf8",
);

test("reference lessons define desktop, tablet and phone layouts", () => {
  for (const breakpoint of [1180, 900, 620]) {
    assert.match(tcpCss, new RegExp(`max-width: ${breakpoint}px`));
  }
  assert.match(generatedCss, /max-width: 760px/);
  assert.match(tcpCss, /\.tcp-system-grid\s*\{[\s\S]*grid-template-columns: 1fr/);
  assert.match(generatedCss, /\.generated-transfer\s*\{[\s\S]*grid-template-columns: 1fr/);
});

test("learning workspaces do not depend on fixed viewport heights", () => {
  assert.doesNotMatch(tcpCss, /height:\s*calc\([^;]*100vh/i);
  assert.doesNotMatch(generatedCss, /height:\s*calc\([^;]*100vh/i);
  assert.doesNotMatch(tcpCss, /position:\s*fixed/i);
  assert.doesNotMatch(generatedCss, /position:\s*fixed/i);
});

test("primary TCP controls and dynamic regions are accessible", () => {
  for (const required of [
    'aria-live="polite"',
    'aria-label="Lesson playback"',
    'aria-label="Lesson chapters"',
    'aria-label="TCP byte stream"',
    "prefers-reduced-motion",
  ]) {
    assert.ok(
      tcpComponent.includes(required) || tcpCss.includes(required),
      `Missing layout or accessibility contract: ${required}`,
    );
  }
});

