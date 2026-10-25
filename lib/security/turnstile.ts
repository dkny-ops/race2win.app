import "server-only";

/** Actions are controlled by the server; callers cannot choose them. */
export type TurnstileAction = "otp_request" | "weekly_leader_verification" | "midrun_human_check";

type Verification =
  | Readonly<{ status: "verified" }>
  | Readonly<{ status: "rejected"; reason: "missing_token" | "invalid_token" | "provider_rejected" | "expired_or_reused" | "action_mismatch" | "hostname_mismatch" }>
  | Readonly<{ status: "unavailable"; reason: "disabled" | "missing_configuration" | "provider_unavailable" }>;

type SiteverifyResponse = Readonly<{
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  "error-codes"?: unknown;
}>;

type Configuration = Readonly<{
  secret: string;
  allowedHostnames: ReadonlySet<string>;
}>;

export type TurnstileFetch = typeof fetch;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 8_000;

function parseHostnames(value: string | undefined): string[] {
  if (!value) return [];
  const items = value.split(",").map((item) => item.trim().toLowerCase());
  return items.length > 0 && items.every(Boolean) ? items : [];
}

function validHostname(hostname: string): boolean {
  // Localhost is deliberately development-only. Ports, paths and wildcards
  // are invalid because Siteverify returns a hostname, never an origin.
  if (hostname === "localhost") return process.env.NODE_ENV === "development";
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname);
}

function configuration(action: TurnstileAction = "otp_request"): Configuration | null {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const hostnames = parseHostnames(process.env.TURNSTILE_ALLOWED_HOSTNAMES);
  const actions = process.env.TURNSTILE_ENABLED_ACTIONS?.split(",").map((action) => action.trim());
  if (!secret || secret.length < 16 || hostnames.length === 0 || hostnames.some((hostname) => !validHostname(hostname))
    || !(actions?.includes(action) || (action === "midrun_human_check" && process.env.TURNSTILE_MIDRUN_ENABLED === "true"))) return null;
  return { secret, allowedHostnames: new Set(hostnames) };
}

function siteKey(): string | null {
  const value = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return value ? value : null;
}

/** The browser receives only the public site key after one complete server decision. */
export function getTurnstileRequestWidgetConfiguration(): Readonly<{ siteKey: string }> | null {
  return getTurnstileWidgetConfiguration("otp_request");
}

function adaptiveConfiguration(): Configuration | null {
  const secret = process.env.TURNSTILE_ADAPTIVE_SECRET_KEY?.trim();
  const hostnames = parseHostnames(process.env.TURNSTILE_ALLOWED_HOSTNAMES);
  if (!secret || secret.length < 16 || hostnames.length === 0 || hostnames.some((hostname) => !validHostname(hostname))) return null;
  return { secret, allowedHostnames: new Set(hostnames) };
}

/** OTP uses Managed; gameplay and Supabase Auth retain their original widget. */
export function getAdaptiveTurnstileRequestWidgetConfiguration(): Readonly<{ siteKey: string; supabaseSiteKey: string }> | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_ADAPTIVE_SITE_KEY?.trim();
  const originalKey = siteKey();
  return adaptiveConfiguration() && key && originalKey && key !== originalKey
    ? { siteKey: key, supabaseSiteKey: originalKey } : null;
}

/** Mandatory independently of the legacy gameplay enforcement switches. */
export async function verifyAdaptiveTurnstileToken(
  token: unknown,
  options: Readonly<{ fetchImpl?: TurnstileFetch; timeoutMs?: number }> = {},
): Promise<Verification> {
  const config = adaptiveConfiguration();
  if (!config || !getAdaptiveTurnstileRequestWidgetConfiguration()) return { status: "unavailable", reason: "missing_configuration" };
  return verifyConfiguredToken(token, "otp_request", config, options);
}

export function getTurnstileWidgetConfiguration(action: TurnstileAction): Readonly<{ siteKey: string }> | null {
  if (process.env.TURNSTILE_ENFORCEMENT_ENABLED !== "true") return null;
  const key = siteKey();
  return configuration(action) && key ? { siteKey: key } : null;
}

function isReuse(response: SiteverifyResponse): boolean {
  return Array.isArray(response["error-codes"]) && response["error-codes"].includes("timeout-or-duplicate");
}

/**
 * Siteverify consumes a token. This intentionally does not retry or persist
 * it. Provider failure is never authorization to request an OTP.
 */
export async function verifyTurnstileToken(
  token: unknown,
  expectedAction: TurnstileAction,
  options: Readonly<{ fetchImpl?: TurnstileFetch; timeoutMs?: number }> = {},
): Promise<Verification> {
  if (process.env.TURNSTILE_ENFORCEMENT_ENABLED !== "true") return { status: "unavailable", reason: "disabled" };
  const config = configuration(expectedAction);
  if (!config || !siteKey()) return { status: "unavailable", reason: "missing_configuration" };
  return verifyConfiguredToken(token, expectedAction, config, options);
}

async function verifyConfiguredToken(
  token: unknown,
  expectedAction: TurnstileAction,
  config: Configuration,
  options: Readonly<{ fetchImpl?: TurnstileFetch; timeoutMs?: number }>,
): Promise<Verification> {
  if (typeof token !== "string" || token.length === 0) return { status: "rejected", reason: "missing_token" };
  if (token.length > TOKEN_MAX_LENGTH) return { status: "rejected", reason: "invalid_token" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? VERIFY_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.secret, response: token, idempotency_key: crypto.randomUUID() }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable", reason: "provider_unavailable" };
    let result: unknown;
    try { result = await response.json(); } catch { return { status: "unavailable", reason: "provider_unavailable" }; }
    if (typeof result !== "object" || result === null || Array.isArray(result) || typeof (result as SiteverifyResponse).success !== "boolean") {
      return { status: "unavailable", reason: "provider_unavailable" };
    }
    const body = result as SiteverifyResponse;
    if (!body.success) return isReuse(body) ? { status: "rejected", reason: "expired_or_reused" } : { status: "rejected", reason: "provider_rejected" };
    if (body.action !== expectedAction) return { status: "rejected", reason: "action_mismatch" };
    if (typeof body.hostname !== "string" || !config.allowedHostnames.has(body.hostname.toLowerCase())) return { status: "rejected", reason: "hostname_mismatch" };
    return { status: "verified" };
  } catch {
    return { status: "unavailable", reason: "provider_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
