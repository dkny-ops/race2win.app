import { ButtonLink } from "@/components/ui/button-link";
import { ROUTES } from "@/lib/routes";

export default function NotFound() {
  return <section className="not-found shell"><p className="eyebrow">404</p><h1>This track does not exist.</h1><p>The page you are looking for is unavailable or has not been built yet.</p><ButtonLink href={ROUTES.home}>BACK TO HOME</ButtonLink></section>;
}
