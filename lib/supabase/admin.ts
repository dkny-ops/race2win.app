import { createClient } from "@supabase/supabase-js";

function getAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Authoritative game services are not configured.");
  return { url, serviceRoleKey };
}

/** Server-only client. Never import this module from a Client Component. */
export function createAdminClient() {
  const { url, serviceRoleKey } = getAdminConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function isAdminConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
