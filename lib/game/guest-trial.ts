// Guest races are unlimited practice runs, never official or prize-eligible.
// Official scores still require an authenticated, server-validated session.
export function guestTrialUsed(): boolean { return false; }
export function claimGuestTrial(): boolean { return true; }
