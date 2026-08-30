import { expect, test } from "@playwright/test";

test.describe("Franklin cinematic battlefield", () => {
  test("opens on the intro and plays the guided story", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("intro-overlay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The Battle of Franklin" })).toBeVisible();

    await page.getByTestId("intro-begin").click();

    await expect(page.getByTestId("intro-overlay")).toHaveCount(0);
    await expect(page.getByTestId("battlefield-canvas")).toBeVisible();
    await expect(page.getByTestId("control-dock")).toBeVisible();

    // The opening beat caption appears once playback crosses the first beat.
    await expect(page.getByTestId("beat-caption")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Winstead Hill Observation" }),
    ).toBeVisible();
  });

  test("navigates chapters from the story rail", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("intro-begin").click();

    const assault = page.getByTestId("chapter-chapter-assault");
    await assault.click();
    await expect(page.locator(".story-rail li.active")).toContainText("Grand Assault");
    await expect(page.getByTestId("dock-clock-time")).toHaveText(/3:0\d PM/);

    await page.getByTestId("chapter-chapter-nightfall").click();
    await expect(page.getByTestId("dock-clock-time")).toHaveText(/7:0\d PM/);
    await expect(page.getByText("Night", { exact: true })).toBeVisible();
  });

  test("scrubs the timeline and pauses playback", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("intro-explore").click();

    const track = page.getByTestId("timeline-track");
    const box = await track.boundingBox();
    if (!box) {
      throw new Error("timeline track not visible");
    }

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect(page.getByTestId("dock-clock-time")).toHaveText(/4:[23]\d PM/);

    await page.getByTestId("play-pause-button").click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByTestId("play-pause-button").click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("opens records with evidence traceability", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("intro-explore").click();

    await page.getByTestId("mode-records").click();
    await expect(page.getByTestId("records-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Claims & confidence/ })).toBeVisible();

    await page.getByRole("button", { name: /Trace on timeline/ }).first().click();
    await expect(page.getByTestId("dock-clock-time")).toHaveText(/3:00 PM/);
  });

  test("shows the epilogue memorial", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("intro-begin").click();

    await page.getByTestId("chapter-epilogue").click();
    await expect(page.getByTestId("epilogue-overlay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The Cost of Five Hours" })).toBeVisible();
    await expect(page.getByText("Patrick R. Cleburne")).toBeVisible();

    await page.getByRole("button", { name: "Explore the field" }).click();
    await expect(page.getByTestId("epilogue-overlay")).toHaveCount(0);
  });

  test("opens the 3D battlefield with vantage points", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("intro-explore").click();

    await page.getByTestId("mode-3d").click();
    await expect(page.getByTestId("battlefield-3d")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".mount-3d canvas")).toBeVisible();

    const winstead = page.getByTestId("vantage-winstead");
    await winstead.click();
    await expect(winstead).toHaveClass(/active/);

    // Time controls continue to drive the 3D scene.
    await page.getByTestId("play-pause-button").click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByTestId("play-pause-button").click();

    // Back to the 2D map.
    await page.getByTestId("mode-explore").click();
    await expect(page.getByTestId("battlefield-canvas")).toBeVisible();
  });

  test("surfaces first-person accounts and lists them with citations", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("intro-explore").click();

    await page.getByTestId("mode-voices").click();
    const panel = page.getByTestId("voices-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Maj. Gen. Patrick R. Cleburne").first()).toBeVisible();

    // Choosing an account moves the clock to it and raises it over the map.
    await page.getByTestId("voice-voice-govan-cleburne").click();
    await expect(page.getByTestId("dock-clock-time")).toHaveText(/3:3\d PM/);

    await page.getByTestId("mode-voices").click();
    const card = page.getByTestId("voice-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("let us die like men");
    await expect(card).toContainText("Cleburne and His Command");

    await card.getByRole("button", { name: "Dismiss account" }).click();
    await expect(card).toHaveCount(0);
  });

  test("turns the synthesized field audio on and off", async ({ page }) => {
    // Probe the audio graph from the page: nothing in the app exposes it, and
    // the point of the test is that the sound is built, not fetched.
    await page.addInitScript(() => {
      const Real = window.AudioContext;
      const probe = { started: 0, context: null as AudioContext | null };
      (window as unknown as { __audioProbe: typeof probe }).__audioProbe = probe;

      window.AudioContext = class extends Real {
        constructor(options?: AudioContextOptions) {
          super(options);
          probe.context = this;
        }

        createBufferSource() {
          const source = super.createBufferSource();
          const start = source.start.bind(source);
          source.start = (...args: Parameters<typeof start>) => {
            probe.started += 1;
            return start(...args);
          };
          return source;
        }
      };
    });

    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.goto("/");
    await page.getByTestId("intro-explore").click();

    const toggle = page.getByTestId("audio-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Field volume")).toHaveCount(0);

    // The height of the assault, where the fire is heaviest.
    await page.getByTestId("chapter-chapter-breach").click();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Field volume")).toBeVisible();

    const readProbe = () =>
      page.evaluate(() => {
        const probe = (window as unknown as {
          __audioProbe: { started: number; context: AudioContext | null };
        }).__audioProbe;
        return { started: probe.started, state: probe.context?.state ?? null };
      });

    await expect.poll(async () => (await readProbe()).state).toBe("running");
    // Wind and the musketry roll loop; the cracks and guns are fired on top.
    await expect.poll(async () => (await readProbe()).started).toBeGreaterThan(12);

    expect(requests.filter((url) => /\.(mp3|ogg|wav|m4a)(\?|$)/i.test(url))).toEqual([]);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Field volume")).toHaveCount(0);
  });

  test("keeps the stage usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByTestId("intro-begin").click();

    await expect(page.getByTestId("battlefield-canvas")).toBeVisible();
    await expect(page.getByTestId("control-dock")).toBeVisible();

    // The chapter rail starts collapsed on small screens and opens on demand.
    await expect(page.getByTestId("story-rail")).not.toBeInViewport();
    await page.getByRole("button", { name: /Chapters/ }).click();
    await expect(page.getByTestId("story-rail")).toBeVisible();
  });
});
