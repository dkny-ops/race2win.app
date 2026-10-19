import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";

// Only this confirmed Supabase Auth identity may administer prizes.
// A verified email sign-in code is handled by the existing /sign-in flow.
const OWNER_EMAIL = "racetowinapp@gmail.com";

export async function getAuthorizedPrizeAdmin() {
  const context = await getVerifiedUserContext();
  if (!context || !isAdminConfigured()) return null;
  const { data: identity, error: identityError } = await context.supabase.auth.getUser();
  if (identityError || identity.user?.id !== context.userId ||
      identity.user.email?.trim().toLowerCase() !== OWNER_EMAIL ||
      !identity.user.email_confirmed_at) return null;
  const admin = createAdminClient();
  const { data: active, error } = await admin.rpc("rtw_server_is_active_admin", {
    p_actor_user_id: context.userId,
  });
  if (error || active !== true) return null;
  return { context, admin };
}
