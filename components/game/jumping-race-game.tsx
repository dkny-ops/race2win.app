"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Platform = { x:number;y:number;w:number;touch:number|null;gone:boolean;color:string };
type State = { player:{x:number;y:number;vy:number;jumps:number}; platforms:Platform[]; camera:number;speed:number;score:number;time:number;over:boolean;started:boolean;last:number };
const W=960,H=540, FLOOR=460, GRAVITY=1650, JUMP=-530, DOUBLE=-665;
const colors=["#21cafa","#ae4bff","#ff55c5","#ffd344","#53ed86"];
function fresh():State {
 return {player:{x:110,y:FLOOR-44,vy:0,jumps:0},platforms:[{x:0,y:FLOOR,w:340,touch:null,gone:false,color:colors[0]}],camera:0,speed:195,score:0,time:0,over:false,started:false,last:0};
}
function draw(ctx:CanvasRenderingContext2D,s:State){
 const {width:w,height:h}=ctx.canvas;ctx.clearRect(0,0,w,h);
 const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#0c1346");sky.addColorStop(.65,"#39318b");sky.addColorStop(1,"#9157b3");ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 for(let i=0;i<65;i++){const x=((i*173.1-s.camera*.11)%(W+80)+W+80)%(W+80);const y=18+(i*89)%360;ctx.fillStyle=i%3?"#b8a8ff":"#ffffff";ctx.globalAlpha=.35+(i%4)*.15;ctx.fillRect(x,y,2,2)}ctx.globalAlpha=1;
 for(let i=0;i<9;i++){const x=((i*247-s.camera*.23)%(W+320)+W+320)%(W+320)-120;const y=300+(i%3)*44;ctx.fillStyle="#413c8a";ctx.beginPath();ctx.ellipse(x,y,180,80,0,0,Math.PI*2);ctx.fill()}
 for(const p of s.platforms){if(p.gone)continue;const x=p.x-s.camera;if(x>W+50||x+p.w< -50)continue;
  const remaining=p.touch===null?3:3-(s.time-p.touch);
  if(remaining<.7&&Math.floor(s.time*13)%2===0)continue;
  ctx.shadowBlur=17;ctx.shadowColor=p.color;ctx.fillStyle=p.color;ctx.fillRect(x,p.y,p.w,23);ctx.shadowBlur=0;
  ctx.fillStyle="#172254";ctx.fillRect(x+3,p.y+8,p.w-6,27);
  ctx.fillStyle=p.color;ctx.globalAlpha=.5;for(let k=36;k<p.w;k+=36)ctx.fillRect(x+k,p.y+8,3,24);ctx.globalAlpha=1;
  if(p.touch!==null){ctx.fillStyle="#fff";ctx.font="bold 18px system-ui";ctx.fillText(Math.max(0,remaining).toFixed(1)+"s",x+8,p.y-12)}
 }
 const px=s.player.x-s.camera,py=s.player.y;ctx.save();ctx.translate(px+18,py+22);
 // Simple original placeholder runner, replaced when approved sprites are uploaded.
 ctx.fillStyle="#2a194a";ctx.fillRect(-9,5,10,21);ctx.fillRect(7,5,10,21);
 ctx.fillStyle="#3ad8ff";ctx.fillRect(-13,20,15,9);ctx.fillRect(5,20,17,9);
 ctx.fillStyle="#6738e8";ctx.fillRect(-15,-16,32,28);
 ctx.fillStyle="#ffe04e";ctx.beginPath();ctx.moveTo(4,-13);ctx.lineTo(-4,1);ctx.lineTo(3,1);ctx.lineTo(-1,11);ctx.lineTo(11,-4);ctx.lineTo(4,-4);ctx.fill();
 ctx.fillStyle="#ffd0a4";ctx.beginPath();ctx.arc(0,-28,17,0,Math.PI*2);ctx.fill();
 ctx.fillStyle="#f7faff";ctx.fillRect(-17,-44,33,11);ctx.fillStyle="#256cf9";ctx.fillRect(-18,-34,35,5);
 ctx.fillStyle="#202c56";ctx.fillRect(8,-31,5,6);
 ctx.restore();
 ctx.fillStyle="#fff";ctx.font="bold 24px system-ui";ctx.fillText("JUMPING RACE",24,40);
 ctx.font="bold 20px system-ui";ctx.fillText("SCORE "+s.score,24,73);ctx.fillText("SPEED "+Math.round(s.speed),W-170,40);
 ctx.font="16px system-ui";ctx.fillText("DOBLE SALTO: "+(2-s.player.jumps),W-188,72);
 if(!s.started||s.over){ctx.fillStyle="rgba(7,10,35,.75)";ctx.fillRect(0,0,W,H);ctx.textAlign="center";ctx.fillStyle="#fff";ctx.font="bold 52px system-ui";ctx.fillText(s.over?"GAME OVER":"JUMPING RACE",W/2,210);ctx.font="23px system-ui";ctx.fillText(s.over?"SCORE: "+s.score:"CORRE AUTOMÁTICAMENTE · DOBLE SALTO",W/2,265);ctx.fillText(s.over?"Pulsa REINICIAR":"Pulsa JUGAR para comenzar",W/2,308);ctx.textAlign="start"}
}
export function JumpingRaceGame(){
 const canvas=useRef<HTMLCanvasElement>(null),game=useRef<State>(fresh()),jumpQueued=useRef(false);
 const [status,setStatus]=useState<"ready"|"playing"|"over">("ready");const [score,setScore]=useState(0);
 const jump=useCallback(()=>{if(game.current.started&&!game.current.over)jumpQueued.current=true},[]);
 const start=useCallback(()=>{game.current=fresh();game.current.started=true;setScore(0);setStatus("playing");jumpQueued.current=false},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.code==="Space"||e.code==="ArrowUp"){e.preventDefault();if(!e.repeat)jump()}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[jump]);
 useEffect(()=>{const c=canvas.current,ctx=c?.getContext("2d");if(!ctx)return;let id=0;let previous=0;
 const tick=(now:number)=>{const s=game.current;const dt=Math.min(.035,(now-previous)/1000||0);previous=now;
 if(s.started&&!s.over){s.time+=dt;s.speed=Math.min(490,195+s.time*4.2);
  const p=s.player;
  if(jumpQueued.current&&p.jumps<2){p.vy=p.jumps===0?JUMP:DOUBLE;p.jumps++}jumpQueued.current=false;
  const oldBottom=p.y+44;p.vy+=GRAVITY*dt;p.x+=s.speed*dt;p.y+=p.vy*dt;
  if(p.vy>=0){for(const platform of s.platforms){if(platform.gone)continue;
   if(p.x+29>platform.x&&p.x+5<platform.x+platform.w&&oldBottom<=platform.y+9&&p.y+44>=platform.y){
    p.y=platform.y-44;p.vy=0;p.jumps=0;if(platform.touch===null)platform.touch=s.time;break;
   }
  }}
  for(const platform of s.platforms)if(platform.touch!==null&&s.time-platform.touch>=3)platform.gone=true;
  const last=s.platforms[s.platforms.length-1];if(last.x+last.w<p.x+W*1.7){
   const gap=80+Math.random()*Math.min(125,s.speed*.3);
   const y=Math.max(255,Math.min(460,last.y+(Math.random()-.5)*115));
   s.platforms.push({x:last.x+last.w+gap,y,w:145+Math.random()*105,touch:null,gone:false,color:colors[s.platforms.length%colors.length]});
  }
  s.platforms=s.platforms.filter(v=>v.x+v.w>p.x-700);
  s.camera=Math.max(0,p.x-205);
  const newScore=Math.floor(Math.max(0,p.x-110)/12);if(newScore!==s.score){s.score=newScore;if(newScore%10===0)setScore(newScore)}
  if(p.y>H+130){s.over=true;setScore(s.score);setStatus("over")}
 }
 draw(ctx,s);id=requestAnimationFrame(tick)};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id)},[]);
 return <section onPointerDown={e=>{if(status==="playing"&&e.pointerType!=="mouse"){e.preventDefault();jump()}}} style={status==="playing"?{position:"fixed",inset:0,zIndex:2147483000,background:"#090d2d",display:"flex",alignItems:"center",justifyContent:"center",width:"100vw",height:"100dvh",overflow:"hidden",touchAction:"none"}:{maxWidth:960,margin:"0 auto",textAlign:"center"}}>
  <canvas ref={canvas} width={W} height={H} onPointerDown={e=>{if(e.pointerType==="mouse"&&status==="playing"){e.preventDefault();jump()}}} aria-label="Jumping Race, toca el juego para saltar dos veces" style={status==="playing"?{width:"100%",height:"100%",objectFit:"contain",display:"block",touchAction:"none",background:"#090d2d"}:{width:"100%",height:"auto",display:"block",border:"2px solid #5260a8",borderRadius:14,touchAction:"manipulation",background:"#151943"}} />
  {status!=="playing"&&<div style={{display:"flex",justifyContent:"center",gap:16,margin:"1rem 0",flexWrap:"wrap"}}><button className="button button--primary" onClick={start}>{status==="over"?"REINICIAR":"JUGAR"}</button></div>}
  {status!=="playing"&&<p>Score: {score} · PC: ESPACIO / ↑ · Celular: TOCA LA PANTALLA · Segundo toque en el aire = DOBLE SALTO</p>}
  {status!=="playing"&&<p style={{opacity:.75,fontSize:".85rem"}}>Versión de desarrollo. Sin puntuaciones oficiales, anuncios ni premios.</p>}
 </section>;
}
