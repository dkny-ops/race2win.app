import { AdsterraGameBanners } from "@/components/marketing/adsterra-game-banners";
import type { FaqItem } from "@/types/public-types";

export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="faq-list">
      {items.map((item, index) => (
        <div key={item.question}>
        <details className="faq-item">
          <summary>{item.question}<span aria-hidden="true">+</span></summary>
          <p>{item.answer}</p>
        </details>
        {[1, 3, 5, 7].includes(index) && <AdsterraGameBanners className="adsterra-inline-section-ad" />}
        </div>
      ))}
    </div>
  );
}
