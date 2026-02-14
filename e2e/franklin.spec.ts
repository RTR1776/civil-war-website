import { expect, test } from "@playwright/test";

test.describe("Franklin immersive battlefield", () => {
  test("loads scene, timeline, narrative controls, and sources", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Battle of Franklin" })).toBeVisible();
    await expect(page.getByTestId("battlefield-scene")).toBeVisible();
    await expect(page.getByTestId("timeline-slider")).toBeVisible();
    await expect(page.getByTestId("guided-mode-toggle")).toBeVisible();
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

  test("handles battlefield camera interactions", async ({ page }) => {
    await page.goto("/");

    const scene = page.getByTestId("battlefield-scene");
    await scene.hover();
    await page.mouse.down({ button: "right" });
    await page.mouse.move(300, 200);
    await page.mouse.up({ button: "right" });

    await page.mouse.wheel(0, 350);
    await expect(scene).toBeVisible();
  });
});
