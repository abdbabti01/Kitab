// Captures the Identity track's documentation screenshots into docs/screenshots/identity.
//   npx vite --port 5174 &  node scripts/identity-shots.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.KITAB_URL ?? "http://localhost:5174";
const out = "docs/screenshots/identity";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
async function shot(name, viewport, steps, fullPage = false) {
  const page = await browser.newPage({ viewport });
  await steps(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  await page.close();
}
const desktop = { width: 1440, height: 1000 };
const phone = { width: 390, height: 844 };

await shot("01-roadmap-1440", desktop, (p) => p.goto(`${base}/learn/identity`));
await shot("02-oauth-flow-1440", desktop, async (p) => {
  await p.goto(`${base}/practice/identity?scenario=oidc-login&callApi=yes`);
  for (let i = 0; i < 13; i++) await p.getByRole("button", { name: "Next step" }).click();
  await p.evaluate(() => document.querySelector(".id-workbench")?.scrollIntoView());
});
await shot("03-sso-1440", desktop, async (p) => {
  await p.goto(`${base}/practice/identity?scenario=sso&after=logout-a`);
  await p.getByRole("button", { name: "Last step" }).click();
  await p.evaluate(() => document.querySelector(".id-workbench")?.scrollIntoView());
});
await shot("04-token-inspector-1440", desktop, async (p) => {
  await p.goto(`${base}/practice/identity/tokens`);
  await p.getByRole("button", { name: /Payload edited after signing/ }).click();
  await p.evaluate(() => document.querySelector(".ti-layout")?.scrollIntoView());
});
await shot("05-authorization-1440", desktop, async (p) => {
  await p.goto(`${base}/practice/identity/authorization`);
  await p.getByLabel("Caller", { exact: true }).selectOption("dave");
  await p.getByLabel("Order", { exact: true }).selectOption("123");
  await p.evaluate(() => document.querySelector(".az-layout")?.scrollIntoView());
});
await shot("06-practice-1440", desktop, async (p) => {
  await p.goto(`${base}/practice/identity/challenges/saml-failure`);
  await p.getByRole("button", { name: /Validates the response and assertion/ }).click();
  await p.evaluate(() => document.querySelector(".ch-diagnose")?.scrollIntoView());
});
await shot("07-lab-1440", desktop, async (p) => {
  await p.goto(`${base}/lab/identity/jwks-verify`);
  await p.getByRole("button", { name: "Check solution" }).click();
  await p.getByRole("button", { name: "Check solution" }).waitFor({ timeout: 20000 });
  await p.evaluate(() => document.querySelector(".eng-results")?.scrollIntoView());
});
await shot("08-lesson-1440", desktop, async (p) => {
  await p.goto(`${base}/learn/identity/oidc`);
  await p.evaluate(() => document.querySelector(".id-walkthrough")?.scrollIntoView());
});
await shot("09-playground-390", phone, async (p) => {
  await p.goto(`${base}/practice/identity?scenario=oidc-login`);
  await p.getByRole("button", { name: "Last step" }).click();
  await p.evaluate(() => document.querySelector(".id-playback")?.scrollIntoView());
});
await shot("10-message-390", phone, async (p) => {
  await p.goto(`${base}/practice/identity?scenario=oidc-login&fault=verifier`);
  await p.getByRole("button", { name: "Last step" }).click();
  await p.getByRole("tab", { name: "Message" }).click();
  await p.evaluate(() => document.querySelector(".id-playback")?.scrollIntoView());
});
await shot("11-state-390", phone, async (p) => {
  await p.goto(`${base}/practice/identity?scenario=sso&after=logout-idp`);
  await p.getByRole("button", { name: "Last step" }).click();
  await p.getByRole("tab", { name: "State" }).click();
  await p.evaluate(() => document.querySelector(".id-playback")?.scrollIntoView());
});
await shot("12-lesson-390", phone, (p) => p.goto(`${base}/learn/identity/fundamentals`));
await browser.close();
console.log(`saved to ${out}`);
