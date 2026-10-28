"use client";

import { useState } from "react";

export function GameCardShareButton({ game }: { game: "race-to-win" | "flappy-race" }) {
  const [notice, setNotice] = useState("");
  const isFlappy = game === "flappy-race";
  const title = isFlappy ? "Flappy Race" : "Race To Win";

  async function share() {
    const url = new URL(isFlappy ? "/games/flappy-race" : "/games/race-to-win", window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title, text: "Play " + title + "!", url });
        setNotice("");
      } else {
        await navigator.clipboard.writeText(url);
        setNotice("LINK COPIED");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("SHARING UNAVAILABLE");
    }
  }

  return (
    <div className="home-card-share">
      <button className="home-card-share__button home-card-share__button--standalone" type="button" onClick={() => void share()} aria-label={"Share " + title} title={"Share " + title}>
        <img src="/icons/share-racetowin.svg" width="27" height="27" alt="" aria-hidden="true" />
      </button>
      {notice ? <span className="home-card-share__notice" role="status">{notice}</span> : null}
    </div>
  );
}
