"use client";
import { useEffect, useRef, useState } from "react";

type Channel = "site" | "race" | "flappy";
const SOURCES: Record<Channel,string> = { site: "/Music%201.mp3", race: "/Race1.mp3", flappy: "/Flappy.mp3" };
const VOLUME: Record<Channel,number> = { site: .22, race: .42, flappy: .42 };
const active = new Map<Channel,HTMLAudioElement>();
function syncSite() {
 const site = active.get("site");
 if (!site) return;
 const gameActive = active.has("race") || active.has("flappy");
 if (document.hidden || gameActive || sessionStorage.getItem("rtw-site-paused")==="1") site.pause();
 else void site.play().catch(()=>{});
}
export function AudioPlayer({ channel, playing = true, showControls = true }: { channel:Channel; playing?:boolean; showControls?:boolean }) {
 const audio = useRef<HTMLAudioElement|null>(null);
 const [volume,setVolume] = useState(VOLUME[channel]);
 const [open,setOpen] = useState(false);
 const [muted,setMuted] = useState(false);
 useEffect(()=>{
  const element = new Audio(SOURCES[channel]); element.loop=true; element.preload="none";
  const stored = Number(localStorage.getItem("rtw-volume-"+channel));
  const initial = localStorage.getItem("rtw-volume-"+channel) !== null && Number.isFinite(stored) ? Math.max(0,Math.min(1,stored)) : VOLUME[channel];
  element.volume=initial; setVolume(initial); setMuted(initial===0);
  audio.current=element;
  const onVisibilityChange=()=>{
   if(document.hidden){element.pause();return;}
   if(channel==="site"){syncSite();return;}
   if(active.get(channel)===element && !element.muted && element.volume>0) void element.play().catch(()=>{});
  };
  const onPageHide=()=>element.pause();
  document.addEventListener("visibilitychange",onVisibilityChange);
  window.addEventListener("pagehide",onPageHide);
  const removeVisibility=()=>{document.removeEventListener("visibilitychange",onVisibilityChange);window.removeEventListener("pagehide",onPageHide);};
  if(channel==="site") {
   active.set(channel,element);
   const unlock=()=>{syncSite();};
   const toggle=()=>{const paused=sessionStorage.getItem("rtw-site-paused")==="1";sessionStorage.setItem("rtw-site-paused",paused?"0":"1");syncSite();window.dispatchEvent(new Event("rtw-site-audio-state"));};
   document.addEventListener("pointerdown",unlock);
   window.addEventListener("rtw-site-toggle",toggle);
   syncSite();
   return ()=>{document.removeEventListener("pointerdown",unlock);window.removeEventListener("rtw-site-toggle",toggle);element.pause();active.delete(channel);removeVisibility();};
  }
  return ()=>{element.pause();active.delete(channel);removeVisibility();syncSite();};
 },[channel]);
 useEffect(()=>{
  if(channel==="site")return;
  const element=audio.current;if(!element)return;
  if(playing){active.set(channel,element);syncSite();if(!document.hidden) void element.play().catch(()=>{});}
  else {element.pause();active.delete(channel);syncSite();}
 },[channel,playing]);
 useEffect(()=>{
  if(channel==="site")return;
  const begin=()=>{const element=audio.current;if(element){active.set(channel,element);syncSite();if(!document.hidden) void element.play().catch(()=>{});}};
  window.addEventListener("rtw-audio-start-"+channel,begin);
  return ()=>window.removeEventListener("rtw-audio-start-"+channel,begin);
 },[channel]);
 if(channel==="site" || !showControls)return null;
 return <div style={{position:"absolute",top:12,right:12,zIndex:10001,display:"flex",alignItems:"center",gap:6,background:"#071a2cdd",padding:6,borderRadius:14}} onPointerDown={e=>e.stopPropagation()}>
  <button type="button" aria-label={open?"Hide volume":"Show volume"} onClick={()=>setOpen(v=>!v)} style={{background:"transparent",color:"white",border:0,fontSize:22,cursor:"pointer"}}>{muted?"🔇":"🔊"}</button>
  {open?<><input aria-label="Music volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);setMuted(v===0);if(audio.current){audio.current.volume=v;if(v>0&&playing)void audio.current.play().catch(()=>{});}localStorage.setItem("rtw-volume-"+channel,String(v));}} style={{width:90}}/><button type="button" aria-label="Mute music" onClick={()=>{const next=!muted;setMuted(next);if(audio.current)audio.current.muted=next;}}>{muted?"ON":"OFF"}</button></>:null}
 </div>;
}
export function SiteAudioSettings(){
 const [paused,setPaused]=useState(true);
 useEffect(()=>{const update=()=>setPaused(sessionStorage.getItem("rtw-site-paused")==="1");update();window.addEventListener("rtw-site-audio-state",update);return()=>window.removeEventListener("rtw-site-audio-state",update);},[]);
 return <button type="button" className="site-language-settings__select" onClick={()=>window.dispatchEvent(new Event("rtw-site-toggle"))}>{paused?"▶ PLAY WEBSITE MUSIC":"⏸ PAUSE WEBSITE MUSIC"}</button>;
}
