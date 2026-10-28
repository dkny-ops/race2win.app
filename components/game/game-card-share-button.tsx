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
      <button className="home-card-share__button" type="button" onClick={() => void share()} aria-label={"Share " + title} title={"Share " + title}>
        <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 4 21 11 14 18v-4.3C7.5 13.7 4 16 2.5 21c-.2-8 3.6-12.8 11.5-13V4Z" />
        </svg>
      </button>
      {notice ? <span className="home-card-share__notice" role="status">{notice}</span> : null}
    </div>
  );
}
