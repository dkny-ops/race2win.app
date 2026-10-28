import type { MetadataRoute } from "next";
const origin = "https://www.racetowin.app";
export default function sitemap(): MetadataRoute.Sitemap {
 const paths = ["/", "/games/race-to-win", "/games/flappy-race", "/rules", "/faq", "/about", "/contact", "/legal/terms", "/legal/privacy", "/legal/cookies"];
 return paths.map(path => ({url: origin + path, changeFrequency: path === "/" ? "weekly" : "monthly", priority: path === "/" ? 1 : path.startsWith("/games/") ? 0.9 : 0.5}));
}
