import {
  battleHourOfDay,
  dayPhase,
  formatBattleClock,
  goldenness,
  nightness,
} from "@/lib/battle/time";

const T = (iso: string) => Date.parse(iso);

describe("formatBattleClock", () => {
  it("formats in the battle's fixed UTC-6 zone regardless of host timezone", () => {
    expect(formatBattleClock(T("1864-11-30T12:00:00-06:00"))).toMatch(/12:00\sPM/);
    expect(formatBattleClock(T("1864-11-30T16:30:00-06:00"))).toMatch(/4:30\sPM/);
    expect(formatBattleClock(T("1864-11-30T21:00:00-06:00"))).toMatch(/9:00\sPM/);
  });
});

describe("battleHourOfDay", () => {
  it("maps timestamps onto local battlefield hours", () => {
    expect(battleHourOfDay(T("1864-11-30T12:00:00-06:00"))).toBeCloseTo(12);
    expect(battleHourOfDay(T("1864-11-30T18:45:00-06:00"))).toBeCloseTo(18.75);
  });
});

describe("dayPhase", () => {
  it("follows the historical light through the battle window", () => {
    expect(dayPhase(T("1864-11-30T13:00:00-06:00"))).toBe("afternoon");
    expect(dayPhase(T("1864-11-30T16:00:00-06:00"))).toBe("golden");
    expect(dayPhase(T("1864-11-30T17:00:00-06:00"))).toBe("dusk");
    expect(dayPhase(T("1864-11-30T19:00:00-06:00"))).toBe("night");
  });
});

describe("nightness", () => {
  it("is monotonically non-decreasing across the battle", () => {
    let previous = -1;
    for (let hour = 12; hour <= 21; hour += 0.25) {
      const stamp = T("1864-11-30T12:00:00-06:00") + (hour - 12) * 3_600_000;
      const value = nightness(stamp);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("is day at noon and night by 7 PM", () => {
    expect(nightness(T("1864-11-30T12:00:00-06:00"))).toBeLessThan(0.02);
    expect(nightness(T("1864-11-30T19:00:00-06:00"))).toBeGreaterThan(0.9);
  });
});

describe("goldenness", () => {
  it("peaks near sunset and fades to nothing at night", () => {
    const noon = goldenness(T("1864-11-30T12:00:00-06:00"));
    const sunset = goldenness(T("1864-11-30T16:10:00-06:00"));
    const night = goldenness(T("1864-11-30T19:00:00-06:00"));

    expect(sunset).toBeGreaterThan(noon);
    expect(sunset).toBeGreaterThan(0.8);
    expect(night).toBeLessThan(0.02);
  });
});
