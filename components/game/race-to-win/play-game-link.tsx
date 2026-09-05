"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";

type PlayGameLinkProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "text";
  className?: string;
};

/**
 * The single public entry point for the current game. Future game cards can
 * supply their own stable game route without coupling to the marketing page.
 */
export function PlayGameLink({
  children,
  variant = "primary",
  className = "",
}: PlayGameLinkProps) {
  return (
    <Link className={`button button--${variant} ${className}`.trim()} href={ROUTES.play}>
      {children}
    </Link>
  );
}
