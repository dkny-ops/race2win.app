import type { Metadata } from "next";
import "./globals.css";
import { AdsterraSocialBar } from "@/components/marketing/adsterra-social-bar";
import { AdsterraVerticalPageAds } from "@/components/marketing/adsterra-vertical-home-ads";
import { AdsterraPublicPageAds } from "@/components/marketing/adsterra-public-page-ads";
import { AudioPlayer } from "@/components/layout/site-audio";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_DESCRIPTION, SITE_NAME } from "@/content/site";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
  other: {
    "google-adsense-account": "ca-pub-9717962248903800",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AudioPlayer channel="site" />
        <SiteHeader />
        <AdsterraSocialBar position="top" />
        <main id="main-content"><AdsterraVerticalPageAds><AdsterraPublicPageAds position="top" />{children}<AdsterraPublicPageAds position="bottom" /></AdsterraVerticalPageAds></main>
        <AdsterraSocialBar />
        <SiteFooter />
      </body>
    </html>
  );
}
