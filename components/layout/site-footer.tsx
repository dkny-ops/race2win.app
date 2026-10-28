import Link from "next/link";
import { SITE_NAME } from "@/content/site";
import { ROUTES } from "@/lib/routes";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <nav aria-label="Legal links" className="footer-links">
          <Link href={ROUTES.terms}>TERMS</Link><Link href={ROUTES.privacy}>PRIVACY</Link><Link href={ROUTES.rules}>RULES</Link><Link href="/about">ABOUT</Link><Link href="/contact">CONTACT</Link>
        </nav>
      </div>
      <div className="shell footer-bottom">© {new Date().getFullYear()} {SITE_NAME}. Information subject to change.</div>
    </footer>
  );
}
