import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return <section className="page-section shell narrow legal-copy"><p className="eyebrow">PROVISIONAL FRAMEWORK</p><h1>Privacy</h1><p className="page-lede">This is an initial structure. A complete privacy policy will be published before account or participation information is collected.</p><h2>Current Public Site</h2><p>This phase has no registration, profile, payment, or prize forms. No player personal information is requested on this site.</p><h2>Future Features</h2><p>Before accounts, communications, or prizes are enabled, clear information about data, purpose, retention, and applicable rights will be defined and published.</p><h2>Security</h2><p>Sensitive information must not be stored in the browser or exposed as part of the public site.</p></section>;
}
