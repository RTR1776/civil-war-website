import { fireEvent, render, screen } from "@testing-library/react";

import BattlefieldExperience from "@/features/battlefield/BattlefieldExperience";
import { loadScenarioData } from "@/lib/battle/scenarioLoader";
import { useBattleStore } from "@/lib/battle/store";
import { buildFranklinBundle } from "@/test-utils/franklinFixture";

vi.mock("@/lib/battle/scenarioLoader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/battle/scenarioLoader")>(
    "@/lib/battle/scenarioLoader",
  );

  return {
    ...actual,
    loadScenarioData: vi.fn(),
  };
});

const mockBundle = buildFranklinBundle();

function resetStore() {
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
      guidedMode: true,
      hoveredEventId: null,
      selectedFormationId: null,
    },
    storyState: {
      activeBeatId: null,
      activeChapterId: null,
      lockedFormationId: null,
      storyComplete: false,
    },
  });
}

describe("BattlefieldExperience", () => {
  beforeEach(() => {
    vi.mocked(loadScenarioData).mockResolvedValue(mockBundle);
    resetStore();
  });

  it("opens on the cinematic intro and starts guided playback", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    expect(screen.getByRole("heading", { name: "The Battle of Franklin" })).toBeVisible();

    fireEvent.click(screen.getByTestId("intro-begin"));

    expect(screen.queryByTestId("intro-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("control-dock")).toBeVisible();
    expect(screen.getByTestId("story-rail")).toBeVisible();
    expect(useBattleStore.getState().simulationState.isPlaying).toBe(true);
    expect(useBattleStore.getState().uiState.guidedMode).toBe(true);
  });

  it("shows the beat caption for the active narrative beat", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    fireEvent.click(screen.getByTestId("intro-begin"));

    // The opening beat fires at the very start of the timeline.
    fireEvent.click(screen.getByTestId("beat-beat-winstead-overlook"));

    expect(screen.getByTestId("beat-caption")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Winstead Hill Observation" }),
    ).toBeVisible();
  });

  it("switches chapters from the story rail", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    fireEvent.click(screen.getByTestId("intro-begin"));

    fireEvent.click(screen.getByTestId("chapter-chapter-assault"));

    const state = useBattleStore.getState();
    expect(state.storyState.activeChapterId).toBe("chapter-assault");
    expect(state.simulationState.simTimeMs).toBe(Date.parse("1864-11-30T15:00:00-06:00"));
  });

  it("opens the records panel with claims and sources", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    fireEvent.click(screen.getByTestId("intro-explore"));

    fireEvent.click(screen.getByTestId("mode-records"));

    expect(screen.getByTestId("records-panel")).toBeVisible();
    expect(screen.getByRole("heading", { name: /Claims & confidence/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeVisible();
  });

  it("shows the epilogue with the fallen generals", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    fireEvent.click(screen.getByTestId("intro-begin"));

    fireEvent.click(screen.getByTestId("chapter-epilogue"));

    expect(screen.getByTestId("epilogue-overlay")).toBeVisible();
    expect(screen.getByText("Patrick R. Cleburne")).toBeVisible();
    expect(screen.getByText("Otho F. Strahl")).toBeVisible();
  });

  it("shows formation intel when a formation is selected", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    fireEvent.click(screen.getByTestId("intro-explore"));

    useBattleStore.getState().selectFormation("conf-cleburne-division");

    expect(await screen.findByTestId("intel-card")).toBeVisible();
    expect(screen.getByText("Cleburne's Division")).toBeVisible();
    expect(screen.getByText("Maj. Gen. Patrick R. Cleburne")).toBeVisible();
  });

  it("enters free exploration without guided mode", async () => {
    render(<BattlefieldExperience />);

    await screen.findByTestId("intro-overlay");
    fireEvent.click(screen.getByTestId("intro-explore"));

    const state = useBattleStore.getState();
    expect(state.uiState.guidedMode).toBe(false);
    expect(state.uiState.sidebarMode).toBe("analyze");
    expect(screen.getByTestId("control-dock")).toBeVisible();
  });
});
