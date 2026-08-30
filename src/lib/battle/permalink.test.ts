import {
  clockToken,
  decodePermalink,
  encodePermalink,
  timeFromClockToken,
} from "@/lib/battle/permalink";

const START = Date.parse("1864-11-30T12:00:00-06:00");

describe("permalink", () => {
  it("writes the battle clock, not the visitor's clock", () => {
    expect(clockToken(START)).toBe("1200");
    expect(clockToken(START + 5 * 3_600_000 + 5 * 60_000)).toBe("1705");
  });

  it("round-trips a moment through the hash", () => {
    const moment = START + 4 * 3_600_000 + 33 * 60_000;
    const hash = encodePermalink({ timeMs: moment, view: "3d" });

    expect(hash).toContain("t=1633");
    const decoded = decodePermalink(hash, START);
    expect(decoded.timeMs).toBe(moment);
    expect(decoded.view).toBe("3d");
  });

  it("carries the selection, the account, and the sound flag", () => {
    const hash = encodePermalink({
      timeMs: START,
      view: "explore",
      formationId: "conf-cleburne-division",
      voiceId: "voice-govan-cleburne",
      sound: true,
    });

    expect(decodePermalink(hash, START)).toEqual({
      timeMs: START,
      view: "explore",
      formationId: "conf-cleburne-division",
      voiceId: "voice-govan-cleburne",
      sound: true,
    });
  });

  it("ignores a malformed or unknown hash rather than throwing", () => {
    expect(decodePermalink("", START)).toEqual({});
    expect(decodePermalink("#", START)).toEqual({});
    expect(decodePermalink("#t=nope&view=hologram", START)).toEqual({});
    expect(decodePermalink("#t=2599", START)).toEqual({});
    expect(timeFromClockToken("7", START)).toBeUndefined();
  });

  it("omits everything it has nothing to say about", () => {
    expect(encodePermalink({})).toBe("");
    expect(encodePermalink({ sound: false })).toBe("");
  });

  it("rolls a rounded 59.7-minute reading into the next hour", () => {
    expect(clockToken(START + 59.7 * 60_000)).toBe("1300");
  });
});
