import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import "../src/learning/engines/index.ts";
import { findJourney, journeys, lessons, lessonsForMission, packetJourney } from "../src/learning/lessons/catalog.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { HTTP_WALKTHROUGH_PATH, parseRoute } from "../src/app/routes.ts";
import { starterOptions } from "../src/practice/network/starters.ts";

// The original HttpWalkthrough export (LF line endings) before Kitab's navigation block was added.
const EXPORT_SHA256 = "395555c5ed2cd4adbff3fc800a2794283d99dda812a657bab0f65ed7f82dc677";
const html = readFileSync(new URL("../public/learn/hello-tcp.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const nav = /<!-- kitab:nav start[\s\S]*?<!-- kitab:nav end -->\n/;

test("the C# walkthrough is the original export plus one delimited navigation block", () => {
  assert.equal(html.match(new RegExp(nav, "g"))?.length, 1);
  assert.equal(createHash("sha256").update(html.replace(nav, "")).digest("hex"), EXPORT_SHA256);
  const trace = JSON.parse(html.match(/<script id="trace-data" type="application\/json">(.*?)<\/script>/s)![1]);
  assert.equal(trace.events.length, 130);
  assert.equal(packetJourney.steps, trace.events.length, "Home shows the real step count");
  assert.ok(Object.keys(trace.sources).includes("Ipv4.cs"), "source-level C# is kept");
});

test("every link in the walkthrough's navigation leads to existing Kitab content", () => {
  const links = [...html.match(nav)![0].matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([, href, text]) => ({ href, text: text.replace("&amp;", "&") }));
  assert.ok(links.some((link) => link.href === "/"), "a way back to Kitab");
  for (const { href, text } of links) {
    const url = new URL(href, "https://kitab.test");
    const route = parseRoute(url.pathname);
    assert.notEqual(route.name, "not-found", href);
    const starter = url.searchParams.get("starter");
    if (starter) assert.equal(starterOptions.find((s) => s.id === starter)?.name, text, href);
    if (url.hash === "#path") assert.equal(route.name, "home", href);
    if (route.name === "mission") assert.equal(findMission(route.id)?.title, text, href);
    if (route.name === "lesson") assert.equal(findJourney(route.id)?.title, text, href);
  }
  for (const { missionId } of packetJourney.practice)
    assert.ok(links.some((link) => link.href === `/missions/${missionId}`), `walkthrough links its practice mission ${missionId}`);
});

test("the walkthrough is the only implementation at its URL and every journey link resolves", () => {
  assert.equal(`/learn/${packetJourney.id}`, HTTP_WALKTHROUGH_PATH);
  assert.ok(!lessons.some((lesson) => lesson.id === packetJourney.id), "no in-app lesson competes for the URL");
  for (const journey of journeys) {
    for (const { missionId } of journey.practice) assert.ok(findMission(missionId), `${journey.id} → ${missionId}`);
    if ("nextLessonId" in journey && journey.nextLessonId) assert.ok(findJourney(journey.nextLessonId), `${journey.id} next`);
  }
  for (const missionId of ["tcp-lost-segment", "tcp-send-window"])
    assert.deepEqual(lessonsForMission(missionId).map((journey) => journey.id), ["hello-tcp"], `${missionId} "learn first"`);
});
