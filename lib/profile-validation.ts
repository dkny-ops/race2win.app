export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUsername(value: string) {
  return value.trim();
}

export function normalizePayPalEmail(value: string) {
  return value.trim().toLowerCase();
}
