// No provider verification or reviewed continuation rules exist yet.
// Browser callbacks must never change these capabilities or issue rewards.
export const FLAPPY_REWARDS = Object.freeze({
  extraLifeAvailable: false,
  doublePointsAvailable: false,
  reason: "provider_verification_and_resume_rules_pending",
} as const);
