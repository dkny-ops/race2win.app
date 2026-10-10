import "server-only";

/**
 * A route must explicitly decide when to require a verified result;
 * `disabled` and `unavailable` are never authorization decisions.
 */
export type TurnstileAction =
  | "otp_request"
  | "otp_verify_step_up"
  | "prize_claim"
  | "balance_claim";

type TurnstileFailureReason =
  | "disabled"
  | "missing_configuration"
  | "missing_token"
  | "invalid_token"
  | "provider_rejected"
  | "expired_or_reused"
  | "action_mismatch"
  | "hostname_mismatch"
  | "provider_unavailable";

export type TurnstileVerification =
  | Readonly<{ status: "verified" }>
  | Readonly<{ status: "rejected"; reason: Exclude<TurnstileFailureReason, "disabled" | "missing_configuration" | "provider_unavailable"> }>
  | Readonly<{ status: "unavailable"; reason: Extract<TurnstileFailureReason, "disabled" | "missing_configuration" | "provider_unavailable"> }>;

type SiteverifyResponse = Readonly<{
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  "error-codes"?: unknown;
}>;

type TurnstileConfiguration = Readonly<{
  secret: string;
  allowedHostnames: ReadonlySet<string>;
  allowedActions: ReadonlySet<TurnstileAction>;
}>;

export type TurnstileFetch = typeof fetch;

export type TurnstileRequestWidgetConfiguration = Readonly<{
  siteKey: string;
}>;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 8_000;
const KNOWN_ACTIONS = new Set<TurnstileAction>([
  "otp_request",
  "otp_verify_step_up",
  "prize_claim",
  "balance_claim",
]);

function isConfiguredHostname(value: string): boolean {
  // Exact hostnames only: no URL, port, wildcard, path, or userinfo.
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  const values = value.split(",").map((entry) => entry.trim().toLowerCase());
  return values.length > 0 && values.every(Boolean) ? values : [];
}

function configuredActions(value: string | undefined): ReadonlySet<TurnstileAction> | null {
  const actions = parseCsv(value);
  if (actions.length === 0 || actions.some((action) => !KNOWN_ACTIONS.has(action as TurnstileAction))) return null;
  return new Set(actions as TurnstileAction[]);
}

function configuration(): TurnstileConfiguration | null {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const hostnames = parseCsv(process.env.TURNSTILE_ALLOWED_HOSTNAMES);
  const actions = configuredActions(process.env.TURNSTILE_ENABLED_ACTIONS);
  if (!secret || secret.length < 16 || hostnames.length === 0 || hostnames.some((hostname) => !isConfiguredHostname(hostname)) || !actions) {
    return null;
  }
  return {
    secret,
    allowedHostnames: new Set(hostnames),
    allowedActions: actions,
  };
}

function configuredSiteKey(): string | null {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return siteKey ? siteKey : null;
}

/**
 * The sign-in page consumes this server-derived value. There is deliberately
 * no independent browser enforcement flag that can drift from the server.
 */
export function getTurnstileRequestWidgetConfiguration(): TurnstileRequestWidgetConfiguration | null {
  if (process.env.TURNSTILE_ENFORCEMENT_ENABLED !== "true") return null;
  const config = configuration();
  const siteKey = configuredSiteKey();
  return config && siteKey ? { siteKey } : null;
}

function providerReportedReuse(body: SiteverifyResponse): boolean {
  return Array.isArray(body["error-codes"]) && body["error-codes"].includes("timeout-or-duplicate");
}

function providerResponseIsWellFormed(body: unknown): body is SiteverifyResponse {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/**
 * Verifies a single Turnstile token with Cloudflare. Cloudflare owns token
 * expiry/single-use enforcement; this module neither persists nor retries a
 * token. Provider/network failures are unavailable, never verified.
 */
export async function verifyTurnstileToken(
  token: unknown,
  expectedAction: TurnstileAction,
  options: Readonly<{ fetchImpl?: TurnstileFetch; timeoutMs?: number }> = {},
): Promise<TurnstileVerification> {
  if (process.env.TURNSTILE_ENFORCEMENT_ENABLED !== "true") {
    return { status: "unavailable", reason: "disabled" };
  }

  const config = configuration();
  if (!config || !configuredSiteKey() || !config.allowedActions.has(expectedAction)) {
    return { status: "unavailable", reason: "missing_configuration" };
  }
  if (typeof token !== "string" || token.length === 0) {
    return { status: "rejected", reason: "missing_token" };
  }
  if (token.length > TOKEN_MAX_LENGTH) {
    return { status: "rejected", reason: "invalid_token" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? VERIFY_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // No client network address: a trusted infrastructure source is not configured.
      body: new URLSearchParams({
        secret: config.secret,
        response: token,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable", reason: "provider_unavailable" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "unavailable", reason: "provider_unavailable" };
    }
    if (!providerResponseIsWellFormed(body) || typeof body.success !== "boolean") {
      return { status: "unavailable", reason: "provider_unavailable" };
    }
    if (!body.success) {
      return providerReportedReuse(body)
        ? { status: "rejected", reason: "expired_or_reused" }
        : { status: "rejected", reason: "provider_rejected" };
    }
    if (body.action !== expectedAction) return { status: "rejected", reason: "action_mismatch" };
    if (typeof body.hostname !== "string" || !config.allowedHostnames.has(body.hostname.toLowerCase())) {
      return { status: "rejected", reason: "hostname_mismatch" };
    }
    return { status: "verified" };
  } catch {
    return { status: "unavailable", reason: "provider_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
