import { test, expect } from "@playwright/test";
import { accessJourney } from "../src/practice/network/access.ts";

test("provider and local choices reset the journey and explain the matching carrier", async ({
  page,
}) => {
  await page.goto("/practice/connections");
  await page.getByRole("button", { name: "Fiber link", exact: true }).click();
  await expect(page.locator(".signal-view")).toContainText("Light signals");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.locator(".access-ip")).toContainText("80 → 62000");
  await page.getByRole("button", { name: "Arrived", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Next step", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /^DSL Copper/ }).click();
  await expect(page.getByLabel("Technology journey timeline")).toHaveValue("0");
  await page.getByRole("button", { name: "DSL link", exact: true }).click();
  await expect(page.locator(".signal-view")).toContainText(
    "Electrical signals · Copper telephone pair",
  );
  await page.getByRole("button", { name: /^Cable Coaxial/ }).click();
  await page.getByRole("button", { name: /^Ethernet Electrical/ }).click();
  await page.getByLabel("Equipment layout").selectOption("separate");
  await expect(page.locator(".access-story")).toContainText(
    "The access point is not used",
  );
  await page.getByRole("button", { name: "Cable link", exact: true }).click();
  await expect(page.locator(".signal-view")).toContainText(
    "Electrical signals · Coaxial cable",
  );
  await page.getByRole("button", { name: "Play journey", exact: true }).click();
  await page
    .getByText("What are the parts inside my home box?", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play journey", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("selecting a box explains its role, and a modem or ONT is never described as routing", async ({ page }) => {
  await page.goto("/practice/connections");
  const about = page.locator(".access-about");
  await expect(about.locator("h2")).toHaveText("ONT");
  await expect(about).toContainText("OLT tells each ONT when it may send");
  await expect(about).toContainText("It does not route, hand out addresses or translate them with NAT");
  await page.getByRole("button", { name: "What does the Home router do?" }).click();
  await expect(about).toContainText("here also the ONT");
  await page.getByRole("combobox").last().selectOption("separate");
  await expect(about).toContainText("connects by an Ethernet cable to the separate ONT");
});

test("NAT records its mapping when the connection's SYN leaves home; the request reuses it", async ({ page }) => {
  const stages = accessJourney("fiber", "wifi", true);
  await page.goto("/practice/connections");
  const timeline = page.getByLabel("Technology journey timeline");
  await timeline.fill(String(stages.findIndex((s) => s.id === "tcp")));
  await expect(page.locator(".access-story")).toContainText("As the SYN leaves home, the router's NAT records the mapping this connection will use.");
  await timeline.fill(String(stages.findIndex((s) => s.id === "route")));
  await expect(page.locator(".access-story")).toContainText("using the mapping it recorded when this connection's SYN went out");
});
