import { battleHourOfDay } from "@/lib/battle/time";

export type PermalinkView = "story" | "explore" | "3d" | "satellite";

export interface PermalinkState {
  /** Absolute sim time in ms, or undefined when the link carries no moment. */
  timeMs?: number;
  view?: PermalinkView;
  formationId?: string;
  voiceId?: string;
  sound?: boolean;
}

const VIEWS: PermalinkView[] = ["story", "explore", "3d", "satellite"];

/** Battle-clock HHMM, e.g. 5:05 PM on the field reads as 1705. */
export function clockToken(timeMs: number): string {
  const hours = battleHourOfDay(timeMs);
  let hh = Math.floor(hours);
  let mm = Math.round((hours - hh) * 60);

  if (mm === 60) {
    mm = 0;
    hh = (hh + 1) % 24;
  }

  return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
}

/**
 * Resolve an HHMM token against a known instant on the same day. The battle
 * runs noon to nine on one afternoon, so a plain time of day is unambiguous
 * and stays readable in the address bar.
 */
export function timeFromClockToken(token: string, referenceMs: number): number | undefined {
  const match = /^(\d{2})(\d{2})$/.exec(token);
  if (!match) {
    return undefined;
  }

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) {
    return undefined;
  }

  const targetHours = hh + mm / 60;
  return referenceMs + (targetHours - battleHourOfDay(referenceMs)) * 3_600_000;
}

/** Build the hash fragment for a moment. Empty string when there is nothing to say. */
export function encodePermalink(state: PermalinkState): string {
  const params = new URLSearchParams();

  if (state.timeMs !== undefined) {
    params.set("t", clockToken(state.timeMs));
  }
  if (state.view) {
    params.set("view", state.view);
  }
  if (state.formationId) {
    params.set("unit", state.formationId);
  }
  if (state.voiceId) {
    params.set("voice", state.voiceId);
  }
  if (state.sound) {
    params.set("sound", "on");
  }

  const encoded = params.toString();
  return encoded ? `#${encoded}` : "";
}

/** Parse a hash fragment written by encodePermalink. Unknown keys are ignored. */
export function decodePermalink(hash: string, referenceMs: number): PermalinkState {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) {
    return {};
  }

  const params = new URLSearchParams(raw);
  const state: PermalinkState = {};

  const token = params.get("t");
  if (token) {
    const timeMs = timeFromClockToken(token, referenceMs);
    if (timeMs !== undefined) {
      state.timeMs = timeMs;
    }
  }

  const view = params.get("view");
  if (view && (VIEWS as string[]).includes(view)) {
    state.view = view as PermalinkView;
  }

  const unit = params.get("unit");
  if (unit) {
    state.formationId = unit;
  }

  const voice = params.get("voice");
  if (voice) {
    state.voiceId = voice;
  }

  if (params.get("sound") === "on") {
    state.sound = true;
  }

  return state;
}
