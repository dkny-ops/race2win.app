"use client";

import { useState } from "react";

const gameTitles = {
  "race-to-win": "Race To Win",
  "flappy-race": "Flappy Race",
  "jumping-race": "Jumping Race",
} as const;

export function GameCardShareButton({ game }: { game: keyof typeof gameTitles }) {
  const [notice, setNotice] = useState("");
  const title = gameTitles[game];

  async function share() {
    const url = new URL("/", window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Race To Win", text: "Discover our games at Race To Win!", url });
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
