import Link from "next/link";

/** Callers provide a fixed, application-internal destination. */
export function BackLink({ href }: Readonly<{ href: string }>) {
  return <Link className="page-back-link" href={href}>← BACK</Link>;
}
