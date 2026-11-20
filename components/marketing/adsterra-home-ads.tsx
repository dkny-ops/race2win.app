"use client";

type AdFrameProps = {
  className: string;
  document: string;
  height: number;
  title: string;
  width: number;
};

const pcBannerDocument = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent}</style></head><body><script>window.atOptions={key:"20fdc8466532d667caf530613bd017bb",format:"iframe",height:90,width:728,params:{}};</script><script async src="https://bauval.org/22/20fdc8466532d667caf530613bd017bb"></script></body></html>`;

const mobileBannerDocument = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent}</style></head><body><script>window.atOptions={key:"65b7d9f72d18a20dc7345201dc2ef23e",format:"iframe",height:250,width:300,params:{}};</script><script async src="https://bauval.org/22/65b7d9f72d18a20dc7345201dc2ef23e"></script></body></html>`;

function AdFrame({ className, document, height, title, width }: AdFrameProps) {
  return (
    <iframe
      className={className}
      height={height}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts"
      scrolling="no"
      srcDoc={document}
      title={title}
      width={width}
    />
  );
}

/**
 * Home-only fixed placements. Each provider script has a unique sandboxed
 * document, so third-party globals cannot reach the app or one another.
 */
export function AdsterraHomeAds() {
  return (
    <section className="home-adsterra-ads" aria-label="Advertisement">
      <AdFrame className="home-adsterra-ads__display home-adsterra-ads__display--desktop" document={pcBannerDocument} height={90} title="Advertisement" width={728} />
      <AdFrame className="home-adsterra-ads__display home-adsterra-ads__display--mobile" document={mobileBannerDocument} height={250} title="Advertisement" width={300} />
    </section>
  );
}
