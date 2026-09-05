import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prizes" };

export default function PrizesPage() {
  return <section className="page-section shell narrow"><p className="eyebrow">GENERAL INFORMATION</p><h1>Prizes, with clarity before entry.</h1><p className="page-lede">Any future prize program will publish its rules, eligibility, verification process, and applicable conditions before it is available.</p><div className="notice"><h2>No prizes announced yet</h2><p>No prize amounts, odds, payment terms, or dates are confirmed at this stage.</p></div><h2>Future principles</h2><ul className="content-list"><li>Public information before entry.</li><li>Specific rules for each game or campaign.</li><li>Eligibility review where required.</li><li>Verification before any award.</li></ul></section>;
}
