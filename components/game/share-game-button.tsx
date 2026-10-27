"use client";
import { useState } from "react";

export function ShareGameButton({ game }: { game: "race-to-win" | "flappy-race" }) {
 const [notice,setNotice]=useState("");
 async function share() {
  const url=new URL("/",window.location.origin).toString();
  const title="Race To Win";
  try {
   if(navigator.share){await navigator.share({title,text:"Discover Race To Win and FlappyRace. Play on our website!",url});setNotice("");return;}
   await navigator.clipboard.writeText(url);setNotice("LINK COPIED");
  } catch(error) {
   if(error instanceof DOMException && error.name==="AbortError")return;
   setNotice("SHARING UNAVAILABLE");
  }
 }
 return <span style={{display:"inline-flex",flexDirection:"column",alignItems:"center",gap:4}}>
  <button type="button" className="rtw-action rtw-action--placeholder" onClick={()=>void share()} aria-label="Share game">↗ SHARE</button>
  {notice?<small role="status">{notice}</small>:null}
 </span>;
}
