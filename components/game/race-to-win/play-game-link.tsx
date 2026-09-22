import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

type PlayGameLinkProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "text";
  className?: string;
};

/**
 * The single public entry point for the current game. Future game cards can
 * supply their own stable game route without coupling to the marketing page.
 */
export async function PlayGameLink({
  children,
  variant = "primary",
  className = "",
}: PlayGameLinkProps) {
  const href = (await getVerifiedUserContext())
    ? ROUTES.play
    : `${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`;
  return (
    <Link className={`button button--${variant} ${className}`.trim()} href={href}>
      {children}
    </Link>
  );
}
