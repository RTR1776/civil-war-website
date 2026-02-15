import { expect, test } from "@playwright/test";

test.describe("Franklin immersive battlefield", () => {
  test("loads map timelapse, timeline, narrative, and sources", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Battle of Franklin" })).toBeVisible();

    const map = page.getByTestId("present-day-map");
    const noToken = page.getByTestId("present-day-map-empty");
    const visibleMap = await map.isVisible().catch(() => false);
    const visibleFallback = await noToken.isVisible().catch(() => false);
    expect(visibleMap || visibleFallback).toBeTruthy();

    await expect(page.getByTestId("timeline-slider")).toBeVisible();
    await expect(page.getByTestId("guided-mode-toggle")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Casualty Counter" })).toBeVisible();

    await page.getByRole("button", { name: "Sources" }).click();
    await expect(page.getByRole("heading", { name: "Source citations" })).toBeVisible();
  });

  test("supports timeline scrubbing and guided beat selection", async ({ page }) => {
    await page.goto("/");

    const slider = page.getByTestId("timeline-slider");
    const min = Number(await slider.getAttribute("min"));
    const max = Number(await slider.getAttribute("max"));

    await slider.fill(String(max));
    await expect(slider).toHaveValue(String(max));

    await slider.fill(String(min));
    await expect(slider).toHaveValue(String(min));

    await page.getByTestId("guided-mode-toggle").click();
    await page.getByTestId("narrative-beat-beat-columbia-pike-breach").click();
    await expect(page.getByText("Columbia Pike Breach")).toBeVisible();
  });
});
