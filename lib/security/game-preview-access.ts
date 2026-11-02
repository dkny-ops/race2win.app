import "server-only";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export async function canAccessGamePreview(slug: string): Promise<boolean> {
 if (!/^[a-z0-9-]{3,64}$/.test(slug) || !isAdminConfigured()) return false;
 const context = await getVerifiedUserContext().catch(() => null);
 if (!context) return false;
 if (await getAuthorizedPrizeAdmin().catch(() => null)) return true;
 const { data, error } = await createAdminClient().from("game_preview_access")
   .select("user_id").eq("game_slug", slug).eq("user_id", context.userId).maybeSingle();
 return !error && data?.user_id === context.userId;
}
