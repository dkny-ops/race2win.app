"use client";
import { useState } from "react";

export function ShareGameButton({ game }: { game?: "race-to-win" | "flappy-race" }) {
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
  <button type="button" className="rtw-action rtw-action--placeholder" onClick={()=>void share()} aria-label="Share game"><span className="rtw-share-text">↗ SHARE</span><svg className="rtw-share-card-icon" viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4 21 11 14 18v-4.3C7.5 13.7 4 16 2.5 21c-.2-8 3.6-12.8 11.5-13V4Z" /></svg></button>
  {notice?<small role="status">{notice}</small>:null}
 </span>;
}
