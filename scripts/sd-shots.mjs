// Screenshots of the System Design pages, desktop and phone. Usage: node scripts/sd-shots.mjs <outDir> [baseUrl]
import { chromium, devices } from "@playwright/test";
const out = process.argv[2] ?? "test-results/sd-shots";
const base = process.argv[3] ?? "http://localhost:5174";
const browser = await chromium.launch();
const errors = [];
for (const [name, options] of [["desktop", { viewport: { width: 1440, height: 1000 } }], ["phone", { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }]]) {
  const page = await browser.newPage(options);
  // Full-page captures repeat a sticky header mid-image; keep it in place for screenshots only.
  const shot = async (file) => (await page.addStyleTag({ content: ".site-header { position: static !important; }" }), page.screenshot({ path: `${out}/${file}-${name}.png`, fullPage: true }));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
  await page.goto(`${base}/practice/architecture?template=load-balanced`);
  await page.getByRole("button", { name: "Run simulation" }).click();
  await page.getByRole("button", { name: "Play" }).waitFor();
  await page.getByLabel("Simulated time").fill("3000");
  await page.locator("[data-node=api-2]").focus();
  await page.keyboard.press("Enter");
  await shot("playground");
  await page.goto(`${base}/practice/architecture/challenges/cache-read-heavy`);
  await page.getByRole("button", { name: "Check my design" }).click();
  await page.getByText(/requirements met|Every requirement/).waitFor();
  await shot("challenge");
  await page.goto(`${base}/learn/system-design/fundamentals`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await shot("lesson");
  await page.goto(`${base}/learn/system-design`);
  await shot("track");
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no page errors");
