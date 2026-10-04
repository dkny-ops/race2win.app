import type { Metadata } from "next";
import { FaqList } from "@/components/marketing/faq-list";
import { FAQS } from "@/content/site";
import { BackLink } from "@/components/navigation/back-link";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return <section className="page-section shell narrow"><BackLink href={ROUTES.home} /><p className="eyebrow">FAQ</p><h1>Frequently asked questions.</h1><p className="page-lede">More details will be shared as features are ready to announce.</p><FaqList items={FAQS} /></section>;
}
