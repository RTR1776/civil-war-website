import { fireEvent, render, screen } from "@testing-library/react";

import TimelineControls from "@/features/battlefield/TimelineControls";

describe("TimelineControls", () => {
  const baseProps = {
    selectedTime: Date.parse("1864-11-30T16:00:00-06:00"),
    startTime: Date.parse("1864-11-30T12:00:00-06:00"),
    endTime: Date.parse("1864-11-30T21:00:00-06:00"),
    isPlaying: false,
    speed: 1 as const,
    timelineEvents: [
      {
        id: "event-one",
        time: "1864-11-30T16:00:00-06:00",
        title: "Mass Assault Begins",
        detail: "Assault wave forms.",
        confidence: "documented" as const,
      },
    ],
    onTogglePlay: vi.fn(),
    onSpeedChange: vi.fn(),
    onTimeChange: vi.fn(),
    onEventHover: vi.fn(),
  };

  it("calls onTimeChange when slider value changes", () => {
    render(<TimelineControls {...baseProps} />);

    fireEvent.change(screen.getByTestId("timeline-slider"), {
      target: { value: `${baseProps.startTime}` },
    });

    expect(baseProps.onTimeChange).toHaveBeenCalledWith(baseProps.startTime);
  });

  it("toggles play state through play button", () => {
    render(<TimelineControls {...baseProps} />);

    fireEvent.click(screen.getByTestId("play-pause-button"));

    expect(baseProps.onTogglePlay).toHaveBeenCalledTimes(1);
  });
});
