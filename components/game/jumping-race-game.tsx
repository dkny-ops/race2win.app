"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import { claimGameAudio, releaseGameAudio } from "@/components/layout/site-audio";
import { TurnstileScript } from "@/app/sign-in/turnstile-widget";
import { AdsterraGameBanners } from "@/components/marketing/adsterra-game-banners";
import {
  freshJumpingRace,
  stepJumpingRace,
  WIDTH as W,
  HEIGHT as H,
  STEP,
  TILE_SIZE,
  type JumpingRaceState,
} from "@/lib/game/jumping-race/engine";


const RUNNER_FRAME_PATHS = [
  "/images/jumping-race/runner/idle_01.png",
  "/images/jumping-race/runner/run_01.png",
  "/images/jumping-race/runner/run_02.png",
  "/images/jumping-race/runner/run_03.png",
  "/images/jumping-race/runner/run_04.png",
  "/images/jumping-race/runner/jump_takeoff_01.png",
  "/images/jumping-race/runner/jump_takeoff_02.png",
  "/images/jumping-race/runner/jump_air_01.png",
  "/images/jumping-race/runner/jump_air_02.png",
  "/images/jumping-race/runner/jump_air_03.png",
  "/images/jumping-race/runner/jump_air_04.png",
  "/images/jumping-race/runner/double_jump_01.png",
  "/images/jumping-race/runner/double_jump_02.png",
  "/images/jumping-race/runner/double_jump_03.png",
  "/images/jumping-race/runner/land_01.png",
  "/images/jumping-race/runner/land_02.png",
  "/images/jumping-race/runner/land_03.png",
] as const;

const RUNNER_SPRITE_SIZE = 120;
const RUNNER_HALO_ALPHA_CUTOFF = 72;
const runnerSprites = new Map<string, HTMLCanvasElement>();
const runnerFeetBaselines = new Map<string, number>();
const scenerySprites: {
  background: HTMLImageElement | null;
  platform1: HTMLImageElement | null;
  platform2: HTMLImageElement | null;
  platform3: HTMLImageElement | null;
  platform4: HTMLImageElement | null;
} = { background: null, platform1: null, platform2: null, platform3: null, platform4: null };
const runnerAnimation = new WeakMap<JumpingRaceState, { lastJumps: number; landingUntil: number; facing: -1 | 1 }>();
let runnerSpritePreload: Promise<void> | null = null;
let scenerySpritePreload: Promise<void> | null = null;

function preloadScenerySprites(): Promise<void> {
  if (scenerySpritePreload) return scenerySpritePreload;

  const load = (key: keyof typeof scenerySprites, path: string) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => { scenerySprites[key] = image; resolve(); };
    image.onerror = () => reject(new Error(`Unable to load Jumping Race scenery: ${path}`));
    image.src = path;
  });
  scenerySpritePreload = Promise.all([
    load("background", "/images/jumping-race/background.png"),
    load("platform1", "/images/jumping-race/platform-1.png"),
    load("platform2", "/images/jumping-race/platform-2.png"),
    load("platform3", "/images/jumping-race/platform-3.png"),
    load("platform4", "/images/jumping-race/platform-4.png"),
  ]).then(() => undefined);
  return scenerySpritePreload;
}

function removeLowAlphaFrameHalo(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Runner sprite cleanup canvas is unavailable");

  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 3; offset < pixels.data.length; offset += 4) {
    const alpha = pixels.data[offset];
    // The supplied frames contain a low-opacity pale studio backdrop. Remove only that
    // faint halo, then softly remap the remaining alpha so white hair and cyan details stay.
    pixels.data[offset] = alpha <= RUNNER_HALO_ALPHA_CUTOFF
      ? 0
      : Math.round(((alpha - RUNNER_HALO_ALPHA_CUTOFF) * 255) / (255 - RUNNER_HALO_ALPHA_CUTOFF));
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function runnerFeetBaseline(image: HTMLCanvasElement): number {
  const context = image.getContext("2d");
  if (!context) return image.height;
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  for (let y = image.height - 1; y >= 0; y--) {
    for (let x = 0; x < image.width; x++) {
      if (pixels[(y * image.width + x) * 4 + 3] > 0) return y + 1;
    }
  }
  return image.height;
}

function preloadRunnerSprites(): Promise<void> {
  if (runnerSpritePreload) return runnerSpritePreload;

  runnerSpritePreload = Promise.all(RUNNER_FRAME_PATHS.map((path) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const cleaned = removeLowAlphaFrameHalo(image);
      runnerSprites.set(path, cleaned);
      runnerFeetBaselines.set(path, runnerFeetBaseline(cleaned));
      resolve();
    };
    image.onerror = () => reject(new Error(`Unable to load approved runner frame: ${path}`));
    image.src = path;
  }))).then(() => undefined);

  return runnerSpritePreload;
}

function frameAt(frames: readonly string[], step: number): string {
  return frames[step % frames.length];
}

function runnerFrame(state: JumpingRaceState): string {
  const current = runnerAnimation.get(state) ?? { lastJumps: 0, landingUntil: 0, facing: 1 as const };
  const grounded = state.player.jumps === 0 && Math.abs(state.player.vy) < 1;

  if (state.telemetry.previousDirection !== 0) current.facing = state.telemetry.previousDirection;
  if (current.lastJumps > 0 && grounded) current.landingUntil = state.time + 0.22;
  current.lastJumps = state.player.jumps;
  runnerAnimation.set(state, current);

  const tick = Math.floor(state.time * 12);
  if (state.time < current.landingUntil) {
    return frameAt([
      "/images/jumping-race/runner/land_01.png",
      "/images/jumping-race/runner/land_02.png",
      "/images/jumping-race/runner/land_03.png",
    ], tick);
  }
  if (state.player.jumps >= 2) {
    return frameAt([
      "/images/jumping-race/runner/double_jump_01.png",
      "/images/jumping-race/runner/double_jump_02.png",
      "/images/jumping-race/runner/double_jump_03.png",
    ], tick);
  }
  if (!grounded) {
    if (state.player.vy < -360) {
      return frameAt([
        "/images/jumping-race/runner/jump_takeoff_01.png",
        "/images/jumping-race/runner/jump_takeoff_02.png",
      ], tick);
    }
    return frameAt([
      "/images/jumping-race/runner/jump_air_01.png",
      "/images/jumping-race/runner/jump_air_02.png",
      "/images/jumping-race/runner/jump_air_03.png",
      "/images/jumping-race/runner/jump_air_04.png",
    ], tick);
  }
  if (!state.started || state.telemetry.previousDirection === 0) {
    return "/images/jumping-race/runner/idle_01.png";
  }
  return frameAt([
    "/images/jumping-race/runner/run_01.png",
    "/images/jumping-race/runner/run_02.png",
    "/images/jumping-race/runner/run_03.png",
    "/images/jumping-race/runner/run_04.png",
  ], tick);
}

function drawRunnerSprite(ctx: CanvasRenderingContext2D, state: JumpingRaceState, x: number, y: number): boolean {
  const frame = runnerFrame(state);
  const image = runnerSprites.get(frame);
  if (!image) return false;

  // The supplied PNGs include transparent padding below their visible shoes. Read each
  // frame's real feet baseline after halo cleanup so it lands on the existing 44px
  // collision box, without changing physics or replay data.
  const feet = runnerFeetBaselines.get(frame) ?? image.height;
  const renderedFeet = RUNNER_SPRITE_SIZE * (feet / image.height);
  const left = x + 17 - RUNNER_SPRITE_SIZE / 2;
  const top = y + 44 - renderedFeet;
  const facing = runnerAnimation.get(state)?.facing ?? 1;
  ctx.save();
  if (facing === -1) {
    ctx.translate(2 * (x + 17), 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, left, top, RUNNER_SPRITE_SIZE, RUNNER_SPRITE_SIZE);
  ctx.restore();
  return true;
}

function drawRunnerFallback(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x + 18, y + 22);
  ctx.fillStyle = "#2a194a";
  ctx.fillRect(-9, 5, 10, 21);
  ctx.fillRect(7, 5, 10, 21);
  ctx.fillStyle = "#3ad8ff";
  ctx.fillRect(-13, 20, 15, 9);
  ctx.fillRect(5, 20, 17, 9);
  ctx.fillStyle = "#6738e8";
  ctx.fillRect(-15, -16, 32, 28);
  ctx.fillStyle = "#ffe04e";
  ctx.beginPath();
  ctx.moveTo(4, -13);
  ctx.lineTo(-4, 1);
  ctx.lineTo(3, 1);
  ctx.lineTo(-1, 11);
  ctx.lineTo(11, -4);
  ctx.lineTo(4, -4);
  ctx.fill();
  ctx.fillStyle = "#ffd0a4";
  ctx.beginPath();
  ctx.arc(0, -28, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f7faff";
  ctx.fillRect(-17, -44, 33, 11);
  ctx.fillStyle = "#256cf9";
  ctx.fillRect(-18, -34, 35, 5);
  ctx.fillStyle = "#202c56";
  ctx.fillRect(8, -31, 5, 6);
  ctx.restore();
}

function drawSceneryBackground(ctx: CanvasRenderingContext2D, state: JumpingRaceState) {
 const image = scenerySprites.background;
 if (image) {
  const scale = Math.max(W / image.naturalWidth, H / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, (W - width) / 2, (H - height) / 2, width, height);
  return;
 }
 const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#0c1346");sky.addColorStop(.65,"#39318b");sky.addColorStop(1,"#9157b3");ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 for(let i=0;i<65;i++){const x=((i*173.1-state.camera*.11)%(W+80)+W+80)%(W+80);const y=18+(i*89)%360;ctx.fillStyle=i%3?"#b8a8ff":"#ffffff";ctx.globalAlpha=.35+(i%4)*.15;ctx.fillRect(x,y,2,2)}ctx.globalAlpha=1;
 for(let i=0;i<9;i++){const x=((i*247-state.camera*.23)%(W+320)+W+320)%(W+320)-120;const y=300+(i%3)*44;ctx.fillStyle="#413c8a";ctx.beginPath();ctx.ellipse(x,y,180,80,0,0,Math.PI*2);ctx.fill()}
}

function drawPlatformSprite(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, color: string) {
 const spaces = Math.max(1, Math.min(4, Math.round(width / TILE_SIZE))) as 1 | 2 | 3 | 4;
 const image = scenerySprites[`platform${spaces}`];
 if (image) {
  // The trimmed PNG begins on its visible upper surface. It is rendered at
  // the engine's physical width without changing its aspect ratio, so p.y
  // remains both the collision plane and the visible landing surface.
  const height = width * (image.naturalHeight / image.naturalWidth);
  ctx.drawImage(image, x, y, width, height);
  return;
 }
 ctx.shadowBlur=17;ctx.shadowColor=color;ctx.fillStyle=color;ctx.fillRect(x,y,width,23);ctx.shadowBlur=0;
 ctx.fillStyle="#172254";ctx.fillRect(x+3,y+8,width-6,27);
 ctx.fillStyle=color;ctx.globalAlpha=.5;for(let k=TILE_SIZE;k<width;k+=TILE_SIZE)ctx.fillRect(x+k,y+8,3,24);ctx.globalAlpha=1;
}

function draw(ctx:CanvasRenderingContext2D,s:JumpingRaceState){
 const {width:w,height:h}=ctx.canvas;ctx.clearRect(0,0,w,h);
 drawSceneryBackground(ctx, s);
 for(const p of s.platforms){const x=p.x-s.camera;if(x>W+50||x+p.w< -50)continue;
  drawPlatformSprite(ctx, x, p.y, p.w, p.color);
 }
 const px=s.player.x-s.camera,py=s.player.y;
 if(!drawRunnerSprite(ctx,s,px,py)) drawRunnerFallback(ctx,px,py);
 ctx.fillStyle="#fff";ctx.font="bold 24px system-ui";ctx.fillText("JUMPING RACE",24,40);
 ctx.font="bold 20px system-ui";ctx.fillText("SCORE "+s.score,24,73);ctx.fillText("SPEED "+Math.round(s.speed),W-170,40);
 ctx.font="16px system-ui";ctx.fillText("DOUBLE JUMP: "+(2-s.player.jumps),W-188,72);
 if(!s.started||s.over){ctx.fillStyle="rgba(7,10,35,.75)";ctx.fillRect(0,0,W,H);ctx.textAlign="center";ctx.fillStyle="#fff";ctx.font="bold 52px system-ui";ctx.fillText(s.over?"GAME OVER":"JUMPING RACE",W/2,210);ctx.font="23px system-ui";ctx.fillText(s.over?"SCORE: "+s.score:"MOVE FORWARD, BACKWARD AND DOUBLE JUMP",W/2,265);ctx.fillText(s.over?"Press PLAY AGAIN":"Press PLAY to start",W/2,308);ctx.textAlign="start"}
}
export function JumpingRaceGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<JumpingRaceState | null>(null);
  const jumpQueued = useRef(false);
  const runStartedAt = useRef(0);
  const music = useRef<HTMLAudioElement | null>(null);
  const countdownTimers = useRef<number[]>([]);
  const keys = useRef(new Set<string>());
  const pointers = useRef(new Map<number, { origin: number; direction: -1 | 0 | 1 }>());
  const [status, setStatus] = useState<"ready" | "countdown" | "playing" | "over">("ready");
  const [countdown, setCountdown] = useState<3 | 2 | 1 | null>(null);
  const [score, setScore] = useState(0);
  const [officialNotice, setOfficialNotice] = useState("");
  const official = useRef<{ id: string; index: number; step: number; lastDirection: -1 | 0 | 1; pending: { step: number; direction: -1 | 0 | 1; jump: boolean }[]; queue: Promise<void>; failed: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const [runnerAssetState, setRunnerAssetState] = useState<"loading" | "ready" | "fallback">("loading");
  const humanCheckContainer = useRef<HTMLDivElement>(null);
  const humanCheckResolver = useRef<((verified: boolean) => void) | null>(null);
  const [humanCheckReady, setHumanCheckReady] = useState(false);
  const [humanCheck, setHumanCheck] = useState<{ sessionId: string; nonce: string; siteKey: string } | null>(null);

  useEffect(() => {
    let active = true;
    void preloadRunnerSprites().then(
      () => { if (active) setRunnerAssetState("ready"); },
      () => { if (active) setRunnerAssetState("fallback"); },
    );
    void preloadScenerySprites().catch(() => undefined);
    return () => { active = false; };
  }, []);

  const clearCountdownTimers = useCallback(() => {
    for (const timer of countdownTimers.current) window.clearTimeout(timer);
    countdownTimers.current = [];
  }, []);

  const verifyOfficialHuman = useCallback(async (sessionId: string, configuration: unknown): Promise<boolean> => {
    if (!configuration || typeof configuration !== "object") return false;
    const check = configuration as Record<string, unknown>;
    if (typeof check.siteKey !== "string" || typeof check.nonce !== "string") return false;
    return new Promise<boolean>((resolve) => {
      humanCheckResolver.current?.(false);
      humanCheckResolver.current = resolve;
      setHumanCheck({ sessionId, siteKey: check.siteKey as string, nonce: check.nonce as string });
    });
  }, []);

  useEffect(() => {
    if (!humanCheck || !humanCheckReady || !humanCheckContainer.current || !window.turnstile) return;
    const api = window.turnstile;
    let active = true;
    let widget: string | null = null;
    const settle = (verified: boolean) => {
      if (!active) return;
      active = false;
      humanCheckResolver.current?.(verified);
      humanCheckResolver.current = null;
      setHumanCheck(null);
    };
    try {
      widget = api.render(humanCheckContainer.current, {
        sitekey: humanCheck.siteKey,
        action: "jumping_race_session_verification",
        cData: humanCheck.nonce,
        size: "invisible",
        execution: "execute",
        appearance: "interaction-only",
        callback: async (token) => {
          try {
            const response = await fetch("/api/jumping-race/human-check", {
              method: "POST", credentials: "same-origin", cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: humanCheck.sessionId, nonce: humanCheck.nonce, token }),
            });
            settle(response.ok && (await response.json() as { verified?: unknown }).verified === true);
          } catch { settle(false); }
        },
        "expired-callback": () => settle(false),
        "error-callback": () => settle(false),
      });
      api.execute(widget);
    } catch { queueMicrotask(() => settle(false)); }
    return () => {
      active = false;
      if (widget) api.remove(widget);
    };
  }, [humanCheck, humanCheckReady]);

  useEffect(() => () => { humanCheckResolver.current?.(false); humanCheckResolver.current = null; }, []);

  const prepareMusic = useCallback(() => {
    if (!music.current) {
      music.current = new Audio("/audio/jumping-race-race.mp3");
      music.current.loop = true;
      music.current.preload = "auto";
    }
    return music.current;
  }, []);

  const musicIsAllowed = useCallback(() => {
    if (sessionStorage.getItem("rtw-site-paused") === "1") return false;
    const siteVolume = localStorage.getItem("rtw-volume-site");
    return siteVolume === null || Number(siteVolume) > 0;
  }, []);

  useEffect(() => {
    const syncPreference = () => {
      const soundtrack = music.current;
      if (!soundtrack) return;
      if (!musicIsAllowed()) {
        soundtrack.pause();
      } else if (game.current?.started && !game.current.over) {
        void soundtrack.play().catch(() => undefined);
      }
    };
    window.addEventListener("rtw-site-audio-state", syncPreference);
    return () => {
      window.removeEventListener("rtw-site-audio-state", syncPreference);
    };
  }, [musicIsAllowed]);

  useEffect(() => () => {
    clearCountdownTimers();
    const soundtrack = music.current;
    soundtrack?.pause();
    if (soundtrack) releaseGameAudio("jumping", soundtrack);
    music.current = null;
  }, [clearCountdownTimers]);

  const flush = useCallback((run: NonNullable<typeof official.current>) => {
    if (!run.pending.length || run.failed) return;
    const actions = run.pending.splice(0);
    const index = run.index++;
    run.queue = run.queue.then(async () => {
      const bytes = new TextEncoder().encode(JSON.stringify(actions));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const digest = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/jumping-race/checkpoint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: run.id, index, actions, digest }),
      });
      if (!response.ok) throw new Error("Checkpoint rejected");
    }).catch(() => { run.failed = true; setOfficialNotice("Official run could not be verified."); });
  }, []);

  const finishOfficial = useCallback(async (run: NonNullable<typeof official.current>) => {
    flush(run);
    await run.queue;
    if (run.failed) { setOfficialNotice("Official score not saved: checkpoint verification failed."); return; }
    try {
      const response = await fetch("/api/jumping-race/finalize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: run.id }),
      });
      const result = await response.json();
      setOfficialNotice(response.ok && result.result?.result_status === "verified"
        ? "Official score verified: " + result.result.score
        : "Score not verified: " + (result.message ?? "Review required"));
    } catch { setOfficialNotice("Unable to finalize official run."); }
  }, [flush]);

  const releaseControls = useCallback(() => {
    keys.current.clear();
    pointers.current.clear();
    jumpQueued.current = false;
  }, []);

  const jump = useCallback(() => {
    if (game.current?.started && !game.current.over) jumpQueued.current = true;
  }, []);

  const start = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setOfficialNotice("");
    clearCountdownTimers();
    const soundtrack = prepareMusic();
    // Keep website music on the pre-game screen. Handoff starts only with
    // the player's PLAY gesture and its 3-2-1 countdown.
    claimGameAudio("jumping", soundtrack);
    soundtrack.pause();
    soundtrack.currentTime = 0;
    soundtrack.volume = 0;
    // Start silently while the click still carries a browser user gesture;
    // it becomes audible only when the 3-2-1 countdown completes.
    if (musicIsAllowed()) void soundtrack.play().catch(() => undefined);
    official.current = null;
    let courseSeed = 0;
    try {
      const response = await fetch("/api/jumping-race/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (response.ok && result.session?.id && Number.isInteger(result.session.courseSeed)) {
        const verified = await verifyOfficialHuman(result.session.id, result.humanVerification);
        if (verified) {
          courseSeed = result.session.courseSeed;
          official.current = { id: result.session.id, index: 1, step: 0, lastDirection: 0, pending: [], queue: Promise.resolve(), failed: false };
          setOfficialNotice("Official run · " + result.session.plays_remaining + " attempts remaining");
        } else {
          setOfficialNotice("Practice mode · Human verification was not completed");
        }
      } else {
        setOfficialNotice(result.message ? "Practice mode · " + result.message : "Practice mode");
      }
    } catch { setOfficialNotice("Practice mode · Official server unavailable"); }
    game.current = freshJumpingRace(courseSeed);
    releaseControls();
    setScore(0);
    setStarting(false);
    setCountdown(3);
    setStatus("countdown");
    countdownTimers.current = [
      window.setTimeout(() => setCountdown(2), 1000),
      window.setTimeout(() => setCountdown(1), 2000),
      window.setTimeout(() => {
        const state = game.current;
        if (!state) return;
        state.started = true;
        runStartedAt.current = performance.now();
        soundtrack.volume = musicIsAllowed() ? 0.35 : 0;
        setCountdown(null);
        setStatus("playing");
        countdownTimers.current = [];
      }, 3000),
    ];
  }, [clearCountdownTimers, musicIsAllowed, prepareMusic, releaseControls, starting, verifyOfficialHuman]);

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
          const run = official.current;
          if (run && !run.failed) {
            const jumpNow = jumpQueued.current;
            if (direction !== run.lastDirection || jumpNow) {
              run.pending.push({ step: run.step, direction, jump: jumpNow });
              run.lastDirection = direction;
            }
            run.step++;
            if (run.step % 120 === 0) flush(run);
          }
          stepJumpingRace(state, direction, jumpQueued.current);
          jumpQueued.current = false;
          accumulated -= STEP;
        }
        if (state.over) {
          releaseControls();
          if (music.current) {
            music.current.pause();
            music.current.currentTime = 0;
            // GAME OVER returns the shared soundtrack to the website unless
            // its existing pause preference says otherwise. PLAY AGAIN claims
            // this channel again when its next countdown starts.
            releaseGameAudio("jumping", music.current);
          }
          setScore(state.score);
          const { jumps, doubleJumps, directionChanges, platformsRemoved } = state.telemetry;
          const measure = "jumping-race:last-run";
          try {
            performance.clearMeasures(measure);
            performance.measure(measure, {
              start: runStartedAt.current,
              detail: { durationSeconds: state.time, score: state.score, jumps, doubleJumps, directionChanges, platformsRemoved },
            });
          } catch { /* Browser performance diagnostics must never block Game Over or score submission. */ }
          setStatus("over");
          if (official.current) void finishOfficial(official.current);
        }
      } else {
        accumulated = 0;
      }
      draw(ctx, state);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [releaseControls, flush, finishOfficial]);

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
  const active = playing || status === "countdown";
  return (
    <>{status === "ready" ? <AdsterraGameBanners className="jumping-game-ad" /> : null}<section onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onLostPointerCapture={endGesture} style={active ? { position: "fixed", inset: 0, zIndex: 2147483000, background: "#090d2d", display: "flex", flexDirection: "column", alignItems: "center", width: "100vw", height: "100dvh", overflow: "hidden", touchAction: "none" } : { maxWidth: 960, margin: "0 auto", textAlign: "center" }}>
      <canvas ref={canvas} width={W} height={H} aria-label="Jumping Race: move left, right and jump" style={active ? { width: "100%", flex: "1 1 0", minHeight: 0, objectFit: "contain", display: "block" } : { width: "100%", height: "auto", display: "block", border: "2px solid #5260a8", borderRadius: 14, background: "#151943" }} />
      {countdown !== null ? <div aria-live="assertive" aria-label={`Race starts in ${countdown}`} style={{ position: "fixed", inset: 0, zIndex: 1, display: "grid", placeItems: "center", pointerEvents: "none", color: "#fff", fontSize: "clamp(7rem, 28vw, 18rem)", fontWeight: 900, fontStyle: "italic", textShadow: "0 0 18px #30dfff, 0 0 54px #5260ff" }}>{countdown}</div> : null}
      {humanCheck ? <div role="status" aria-live="polite" style={{ position: "fixed", inset: 0, zIndex: 2, display: "grid", placeItems: "center", background: "rgba(4, 7, 26, .78)", color: "white", textAlign: "center", padding: 24 }}><div><p>VERIFYING OFFICIAL SESSION…</p><div ref={humanCheckContainer} /><TurnstileScript onReady={() => setHumanCheckReady(true)} onError={() => { humanCheckResolver.current?.(false); humanCheckResolver.current = null; setHumanCheck(null); }} /></div></div> : null}
      {status === "over" ? <div role="status" aria-live="polite" style={{ padding: "12px 16px", fontWeight: 800, fontSize: "1.4rem", color: "#fff" }}>GAME OVER · SCORE: {score}</div> : null}
      {active ? null : (
        <>
          <div style={{ margin: "1rem 0", display: "flex", justifyContent: "center", gap: ".75rem", flexWrap: "wrap" }}><button type="button" className="button button--primary" onClick={() => void start()} disabled={starting || runnerAssetState === "loading"}>{runnerAssetState === "loading" ? "LOADING RUNNER..." : starting ? "CONNECTING..." : status === "over" ? "PLAY AGAIN" : "PLAY"}</button><Link className="button button--secondary" href="/games/jumping-race/scores#leaderboard">LEADERBOARD</Link></div>
          {runnerAssetState === "fallback" ? <p role="alert" data-testid="jumping-race-runner-fallback">Developer diagnostic: approved runner sprites did not load; using the visual fallback.</p> : null}
          {officialNotice ? <p role="status" aria-live="polite" style={{ color: "#fff", padding: "8px 12px" }}>{officialNotice}</p> : null}
          <p>Score: {score} · PC: Use ← / → to move and SPACE to jump · Mobile: Drag on the left half to move and tap the right half to jump. Tap again in midair to double jump.</p>
        </>
      )}
    </section></>
  );
}
