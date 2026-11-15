"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  freshJumpingRace,
  stepJumpingRace,
  WIDTH as W,
  HEIGHT as H,
  STEP,
  TILE_SIZE,
  type JumpingRaceState,
} from "@/lib/game/jumping-race/engine";

function draw(ctx:CanvasRenderingContext2D,s:JumpingRaceState){
 const {width:w,height:h}=ctx.canvas;ctx.clearRect(0,0,w,h);
 const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#0c1346");sky.addColorStop(.65,"#39318b");sky.addColorStop(1,"#9157b3");ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 for(let i=0;i<65;i++){const x=((i*173.1-s.camera*.11)%(W+80)+W+80)%(W+80);const y=18+(i*89)%360;ctx.fillStyle=i%3?"#b8a8ff":"#ffffff";ctx.globalAlpha=.35+(i%4)*.15;ctx.fillRect(x,y,2,2)}ctx.globalAlpha=1;
 for(let i=0;i<9;i++){const x=((i*247-s.camera*.23)%(W+320)+W+320)%(W+320)-120;const y=300+(i%3)*44;ctx.fillStyle="#413c8a";ctx.beginPath();ctx.ellipse(x,y,180,80,0,0,Math.PI*2);ctx.fill()}
 for(const p of s.platforms){const x=p.x-s.camera;if(x>W+50||x+p.w< -50)continue;
  ctx.shadowBlur=17;ctx.shadowColor=p.color;ctx.fillStyle=p.color;ctx.fillRect(x,p.y,p.w,23);ctx.shadowBlur=0;
  ctx.fillStyle="#172254";ctx.fillRect(x+3,p.y+8,p.w-6,27);
  ctx.fillStyle=p.color;ctx.globalAlpha=.5;for(let k=TILE_SIZE;k<p.w;k+=TILE_SIZE)ctx.fillRect(x+k,p.y+8,3,24);ctx.globalAlpha=1;
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
 if(!s.started||s.over){ctx.fillStyle="rgba(7,10,35,.75)";ctx.fillRect(0,0,W,H);ctx.textAlign="center";ctx.fillStyle="#fff";ctx.font="bold 52px system-ui";ctx.fillText(s.over?"GAME OVER":"JUMPING RACE",W/2,210);ctx.font="23px system-ui";ctx.fillText(s.over?"SCORE: "+s.score:"AVANZA, RETROCEDE Y HAZ DOBLE SALTO",W/2,265);ctx.fillText(s.over?"Pulsa REINICIAR":"Pulsa JUGAR para comenzar",W/2,308);ctx.textAlign="start"}
}
export function JumpingRaceGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<JumpingRaceState | null>(null);
  const jumpQueued = useRef(false);
  const keys = useRef(new Set<string>());
  const pointers = useRef(new Map<number, { origin: number; direction: -1 | 0 | 1 }>());
  const [status, setStatus] = useState<"ready" | "playing" | "over">("ready");
  const [score, setScore] = useState(0);

  const releaseControls = useCallback(() => {
    keys.current.clear();
    pointers.current.clear();
    jumpQueued.current = false;
  }, []);

  const jump = useCallback(() => {
    if (game.current?.started && !game.current.over) jumpQueued.current = true;
  }, []);

  const start = useCallback(() => {
    game.current = freshJumpingRace();
    game.current.started = true;
    releaseControls();
    setScore(0);
    setStatus("playing");
  }, [releaseControls]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const movement = ["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code);
      const jumping = ["Space", "ArrowUp", "KeyW"].includes(event.code);
      if (event.type === "keyup") {
        keys.current.delete(event.code);
        return;
      }
      if (!game.current?.started || game.current.over || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!movement && !jumping) return;
      event.preventDefault();
      if (movement) keys.current.add(event.code);
      if (jumping && !event.repeat) jump();
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    window.addEventListener("blur", releaseControls);
    document.addEventListener("visibilitychange", releaseControls);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
      window.removeEventListener("blur", releaseControls);
      document.removeEventListener("visibilitychange", releaseControls);
    };
  }, [jump, releaseControls]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    game.current ??= freshJumpingRace();
    let id = 0;
    let previous: number | undefined;
    let accumulated = 0;
    const tick = (now: number) => {
      const state = game.current!;
      const elapsed = previous === undefined ? 0 : Math.min(.05, (now - previous) / 1000);
      previous = now;
      if (state.started && !state.over) {
        accumulated += elapsed;
        const held = [...pointers.current.values()].map(pointer => pointer.direction);
        const left = held.includes(-1) || keys.current.has("ArrowLeft") || keys.current.has("KeyA");
        const right = held.includes(1) || keys.current.has("ArrowRight") || keys.current.has("KeyD");
        const direction = left === right ? 0 : left ? -1 : 1;
        while (accumulated >= STEP && !state.over) {
          stepJumpingRace(state, direction, jumpQueued.current);
          jumpQueued.current = false;
          accumulated -= STEP;
        }
        if (state.over) {
          releaseControls();
          setScore(state.score);
          setStatus("over");
        }
      } else {
        accumulated = 0;
      }
      draw(ctx, state);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [releaseControls]);

  function startGesture(event: PointerEvent<HTMLElement>) {
    if (status !== "playing" || event.button !== 0) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.pointerType === "mouse" || event.clientX >= bounds.left + bounds.width / 2) {
      jump();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { origin: event.clientX, direction: 0 });
  }

  function moveGesture(event: PointerEvent<HTMLElement>) {
    const pointer = pointers.current.get(event.pointerId);
    if (!pointer) return;
    const delta = event.clientX - pointer.origin;
    pointer.direction = delta < -8 ? -1 : delta > 8 ? 1 : 0;
  }

  function endGesture(event: PointerEvent<HTMLElement>) {
    pointers.current.delete(event.pointerId);
  }

  const playing = status === "playing";
  return (
    <section onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onLostPointerCapture={endGesture} style={playing ? { position: "fixed", inset: 0, zIndex: 2147483000, background: "#090d2d", display: "flex", flexDirection: "column", alignItems: "center", width: "100vw", height: "100dvh", overflow: "hidden", touchAction: "none" } : { maxWidth: 960, margin: "0 auto", textAlign: "center" }}>
      <canvas ref={canvas} width={W} height={H} aria-label="Jumping Race: usa izquierda, derecha y salto" style={playing ? { width: "100%", flex: "1 1 0", minHeight: 0, objectFit: "contain", display: "block" } : { width: "100%", height: "auto", display: "block", border: "2px solid #5260a8", borderRadius: 14, background: "#151943" }} />
      {playing ? null : (
        <>
          <div style={{ margin: "1rem 0" }}><button type="button" className="button button--primary" onClick={start}>{status === "over" ? "REINICIAR" : "JUGAR"}</button></div>
          <p>Score: {score} · PC: ← / → para moverte y ESPACIO para saltar · Celular: arrastra en la mitad izquierda para moverte y toca la derecha para saltar. Toca otra vez en el aire para el doble salto.</p>
          <p style={{ opacity: .75, fontSize: ".85rem" }}>Versión de desarrollo. Sin puntuaciones oficiales, anuncios ni premios.</p>
        </>
      )}
    </section>
  );
}
