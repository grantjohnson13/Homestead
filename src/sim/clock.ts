/**
 * Turning the raw tick counter into a time of day.
 *
 * `state.clock` counts game-minutes since the farm was created, which is the
 * right thing to simulate against but the wrong thing to show a player: a
 * counter reading "4h 37m" and climbing every second looks like a broken
 * stopwatch rather than a morning on a farm.
 *
 * The pace is unchanged — one real second is still one game-minute, so crops
 * finish while you are mid-conversation. Only the presentation differs.
 */

/** Farms wake up early. Minute 0 of a new farm is 6am on day one. */
export const DAY_START_HOUR = 6;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export interface FarmTime {
  /** 1-based day number. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** "Day 2 · 07:15" */
  label: string;
  /** Rough part of day, for narration and (later) art. */
  partOfDay: "dawn" | "morning" | "afternoon" | "evening" | "night";
}

export function farmTime(clockMinutes: number): FarmTime {
  const total = Math.max(0, Math.floor(clockMinutes)) + DAY_START_HOUR * MINUTES_PER_HOUR;
  const day = Math.floor(total / MINUTES_PER_DAY) + 1;
  const intoDay = total % MINUTES_PER_DAY;
  const hour = Math.floor(intoDay / MINUTES_PER_HOUR);
  const minute = intoDay % MINUTES_PER_HOUR;

  return {
    day,
    hour,
    minute,
    label: `Day ${day} · ${pad(hour)}:${pad(minute)}`,
    partOfDay: partOfDay(hour),
  };
}

function partOfDay(hour: number): FarmTime["partOfDay"] {
  if (hour < 6) return "night";
  if (hour < 9) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
