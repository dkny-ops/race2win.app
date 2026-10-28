import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
 return {rules:[{userAgent:"*",allow:"/",disallow:["/admin/","/api/","/profile","/wallet","/sign-in","/terms/accept"]}],sitemap:"https://www.racetowin.app/sitemap.xml"};
}
