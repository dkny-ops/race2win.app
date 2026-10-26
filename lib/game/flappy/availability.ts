export type FlappyAvailability = {
  limit: 5;
  remaining: number;
  serverNow: string;
  nextAvailableAt: string | null;
  activeUntil: string | null;
};

export function parseFlappyAvailability(value: unknown): FlappyAvailability {
  const a = value as FlappyAvailability;
  if (!a || a.limit !== 5 || !Number.isInteger(a.remaining) || a.remaining < 0 || a.remaining > 5 ||
      !Number.isFinite(Date.parse(a.serverNow)) ||
      (a.nextAvailableAt !== null && !Number.isFinite(Date.parse(a.nextAvailableAt))) ||
      (a.activeUntil !== null && !Number.isFinite(Date.parse(a.activeUntil))) ||
      (a.remaining < 5 && a.nextAvailableAt === null)) throw new Error("Invalid availability");
  return a;
}
