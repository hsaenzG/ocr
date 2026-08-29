import type { Clock } from "../ports.js";

export function createClock(): Clock {
  return {
    nowIso(): string {
      return new Date().toISOString();
    },
  };
}
