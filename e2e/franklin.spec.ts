import { expect, test } from "@playwright/test";

test.describe("Franklin immersive battlefield v2", () => {
  test("runs story-first guided flow with director controls", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Battle of Franklin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chapter Director" })).toBeVisible();

    const assaultChapter = page.getByTestId("chapter-chapter-assault");
    await assaultChapter.click();
    await expect(assaultChapter).toHaveClass(/active/);

    await page.getByRole("button", { name: "Replay Chapter" }).click();
    await page.getByRole("button", { name: "Skip to Pivotal" }).click();

    await page.getByTestId("guided-mode-toggle").click();
    await expect(page.getByText("Free Analysis")).toBeVisible();
  });

  test("switches reconstructed and modern map modes", async ({ page }) => {
    await page.goto("/");

    const modernButton = page.getByRole("button", { name: "Modern Comparison" });
    const reconstructedButton = page.getByRole("button", { name: "Reconstructed 1864" });

    await modernButton.click();
    await expect(modernButton).toHaveClass(/active/);

    await reconstructedButton.click();
    await expect(reconstructedButton).toHaveClass(/active/);
  });

  test("keeps map primary with bottom-sheet modes on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.locator(".panel-stack.bottom-sheet")).toBeVisible();

    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("heading", { name: "Casualty Counter" })).toBeVisible();

    await page.getByRole("button", { name: "Evidence" }).click();
    await expect(page.getByRole("heading", { name: "Claims and Confidence" })).toBeVisible();
  });

  test("supports evidence traceability to timeline", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Evidence" }).click();
    await expect(page.getByRole("heading", { name: "Claims and Confidence" })).toBeVisible();

    await page.getByRole("button", { name: "Trace on Timeline" }).first().click();
    await expect(page.locator(".event-callout")).toBeVisible();
  });
});
