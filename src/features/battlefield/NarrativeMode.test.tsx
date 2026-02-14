import { fireEvent, render, screen } from "@testing-library/react";

import NarrativeMode from "@/features/battlefield/NarrativeMode";

const beat = {
  id: "beat-breach",
  time: "1864-11-30T17:00:00-06:00",
  title: "Breach",
  description: "Breach point opens.",
  cameraPose: {
    lat: 35.9213,
    lng: -86.859,
    distance: 44,
    pitch: 34,
    yaw: 73,
  },
  focusUnitIds: ["union-cox-division"],
};

describe("NarrativeMode", () => {
  it("calls onSelectBeat with the beat including camera pose", () => {
    const onSelectBeat = vi.fn();

    render(
      <NarrativeMode
        beats={[beat]}
        guidedMode={false}
        activeBeatId={null}
        onToggleGuidedMode={vi.fn()}
        onSelectBeat={onSelectBeat}
      />,
    );

    fireEvent.click(screen.getByTestId("narrative-beat-beat-breach"));

    expect(onSelectBeat).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "beat-breach",
        cameraPose: expect.objectContaining({
          lat: 35.9213,
          lng: -86.859,
          distance: 44,
          pitch: 34,
          yaw: 73,
        }),
      }),
    );
  });
});
