// Guest trials are promotional only; this browser marker is not a security boundary.
// Official scores and prizes always require a separately authenticated server session.
const KEY = "rtw:guest-trial-used:v1";
export function guestTrialUsed(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; }
  catch { return true; } // fail closed if storage is disabled
}
export function claimGuestTrial(): boolean {
  if (guestTrialUsed()) return false;
  try { window.localStorage.setItem(KEY, "1"); return true; }
  catch { return false; }
}
