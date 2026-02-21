import { fireEvent, render, screen } from "@testing-library/react";

import manifest from "../../../public/data/franklin/manifest.json";
import divisions from "../../../public/data/franklin/divisions.json";
import events from "../../../public/data/franklin/events.json";
import sources from "../../../public/data/franklin/sources.json";
import chapters from "../../../public/data/franklin/chapters.json";
import mapLayers from "../../../public/data/franklin/mapLayers.json";
import evidence from "../../../public/data/franklin/evidence.json";

import BattlefieldExperienceV2 from "@/features/battlefield/BattlefieldExperienceV2";
import { buildScenarioBundle, loadScenarioData } from "@/lib/battle/scenarioLoader";
import { useBattleStore } from "@/lib/battle/store";

vi.mock("@/lib/battle/scenarioLoader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/battle/scenarioLoader")>(
    "@/lib/battle/scenarioLoader",
  );

  return {
    ...actual,
    loadScenarioData: vi.fn(),
  };
});

const mockBundle = buildScenarioBundle({
  manifest,
  divisions,
  events,
  sources,
  chapters,
  mapLayers,
  evidence,
});

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("BattlefieldExperienceV2", () => {
  beforeEach(() => {
    vi.mocked(loadScenarioData).mockResolvedValue(mockBundle);
    mockMatchMedia(false);

    useBattleStore.setState({
      data: null,
      simulationState: {
        simTimeMs: 0,
        minTimeMs: 0,
        maxTimeMs: 0,
        isPlaying: false,
        speed: 1,
        tickAccumulatorMs: 0,
      },
      uiState: {
        sidebarMode: "story",
        mapMode: "reconstructed",
        guidedMode: false,
        hoveredEventId: null,
        selectedFormationId: null,
      },
      storyState: {
        activeBeatId: null,
        activeChapterId: null,
        lockedFormationId: null,
        overlayText: null,
      },
      selectedTime: 0,
      isPlaying: false,
      speed: 1,
      guidedMode: false,
      activeBeatId: null,
      hoveredEventId: null,
      sidebarMode: "story",
      mapMode: "reconstructed",
    });
  });

  it("switches between story/analyze/evidence modes", async () => {
    render(<BattlefieldExperienceV2 />);

    await screen.findByTestId("battlefield-app-v2");

    expect(screen.getByRole("heading", { name: "Chapter Director" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByRole("heading", { name: "Casualty Counter" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(screen.getByRole("heading", { name: "Claims and Confidence" })).toBeVisible();
  });

  it("reflects reduced motion preference in status panel", async () => {
    mockMatchMedia(true);

    render(<BattlefieldExperienceV2 />);

    await screen.findByTestId("battlefield-app-v2");

    expect(screen.getByText("Reduced")).toBeVisible();
  });
});
