export const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;

export function isTimedOut(timestampIso: string): boolean {
  return Date.now() - new Date(timestampIso).getTime() > GENERATION_TIMEOUT_MS;
}
