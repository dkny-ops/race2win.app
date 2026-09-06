import * as THREE from "three";
import {
  CollisionSparks,
  createRoadAssets,
  createRoadSegment,
  RoadHazeSystem,
  TireSmokeSystem,
  type RaceToWinQuality,
  ROAD_SEGMENT_LENGTH,
  SpeedStreakSystem,
} from "./environment";
import { RaceToWinCity } from "./city";
import {
  createModelVehicleVisual,
  disposeModelVehicleVisual,
  isModelVehicleVisual,
  loadRaceToWinVehicleTemplates,
  type RaceToWinVehicleTemplates,
} from "./model-vehicles";
import { createPlayerVehicle, createTrafficVehicle, createVehicleAssets, type VehicleVisual } from "./vehicles";
import type { RaceToWinSnapshot, TrafficSnapshot } from "./types";

const PLAYER_START_SPEED_KPH = 97;
const PLAYER_MAX_SPEED_KPH = 360;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function damp(current: number, target: number, deltaSeconds: number, smoothing: number): number {
  return THREE.MathUtils.damp(current, target, smoothing, deltaSeconds);
}

export function getRaceToWinQuality(): RaceToWinQuality {
  const narrowViewport = window.matchMedia("(max-width: 700px)").matches;
  const limitedHardware = window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
  const mobile = narrowViewport || limitedHardware;
  return {
    mobile,
    shadows: !mobile,
    roadSegments: mobile ? 6 : 8,
    trafficLimit: mobile ? 18 : 30,
    particleCount: mobile ? 28 : 58,
    pixelRatioCap: mobile ? 1.25 : 1.75,
  };
}

/**
 * Rendering-only world. It consumes simulation snapshots but cannot affect
 * score rules, seed generation, or the accepted input timeline.
 */
export class RaceToWinWorld {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene = new THREE.Scene();
  public readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 430);
  public readonly quality: RaceToWinQuality;

  private readonly roadAssets = createRoadAssets();
  private readonly vehicleAssets = createVehicleAssets();
  private readonly roadSegments: THREE.Group[] = [];
  private readonly city: RaceToWinCity;
  private player: VehicleVisual;
  private readonly trafficVisuals = new Map<number, VehicleVisual>();
  private readonly speedStreaks: SpeedStreakSystem;
  private readonly roadHaze: RoadHazeSystem;
  private readonly tireSmoke: TireSmokeSystem;
  private readonly collisionSparks: CollisionSparks;
  private readonly cameraLookAt = new THREE.Vector3();
  private previousPlayerX = 0;
  private lastCollisionAt: number | null = null;
  private wasRunning = false;
  private wasChangingLanes = false;
  private vehicleTemplates: RaceToWinVehicleTemplates | null = null;
  private disposed = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.quality = getRaceToWinQuality();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.quality.mobile,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.setClearColor("#090f1b", 1);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.48;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color("#090f1b");
    this.scene.fog = new THREE.FogExp2("#1b2635", this.quality.mobile ? 0.007 : 0.0055);

    this.camera.position.set(0, 7.25, 14.1);
    this.camera.lookAt(0, 1.05, -21);

    this.addLights();
    for (let index = -1; index < this.quality.roadSegments - 1; index += 1) {
      const segment = createRoadSegment(this.roadAssets, index + 1);
      this.roadSegments.push(segment);
      this.scene.add(segment);
    }
    this.city = new RaceToWinCity(this.quality);
    this.scene.add(this.city.object);

    this.player = createPlayerVehicle(this.vehicleAssets);
    this.player.root.position.set(0, 0.05, 0);
    this.player.root.castShadow = true;
    this.scene.add(this.player.root);

    this.speedStreaks = new SpeedStreakSystem(this.quality.particleCount);
    this.scene.add(this.speedStreaks.object);
    this.roadHaze = new RoadHazeSystem(Math.ceil(this.quality.particleCount * 0.68));
    this.scene.add(this.roadHaze.object);
    this.tireSmoke = new TireSmokeSystem(this.quality.mobile ? 36 : 64);
    this.scene.add(this.tireSmoke.object);
    this.collisionSparks = new CollisionSparks(this.quality.mobile ? 28 : 52);
    this.scene.add(this.collisionSparks.object);

    void this.loadOwnedVehicleAssets();
  }

  public resize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  public update(snapshot: RaceToWinSnapshot, deltaSeconds: number): void {
    this.updateRoad(snapshot.metrics.distanceMeters);
    this.updatePlayer(snapshot, deltaSeconds);
    this.updateTraffic(snapshot.traffic, snapshot.metrics.speedKph, deltaSeconds);
    this.updateCamera(snapshot, deltaSeconds);
    this.speedStreaks.update(snapshot.metrics.distanceMeters, snapshot.metrics.speedKph);
    this.roadHaze.update(snapshot.metrics.distanceMeters, snapshot.metrics.speedKph);
    if (snapshot.state === "running" && !this.wasRunning) this.tireSmoke.trigger(snapshot.player.laneX, false);
    if (snapshot.player.isChangingLanes && !this.wasChangingLanes) this.tireSmoke.trigger(snapshot.player.laneX, true);
    this.wasRunning = snapshot.state === "running";
    this.wasChangingLanes = snapshot.player.isChangingLanes;
    this.tireSmoke.update(deltaSeconds);

    if (snapshot.collision && snapshot.collision.atMs !== this.lastCollisionAt) {
      this.lastCollisionAt = snapshot.collision.atMs;
      this.collisionSparks.trigger(snapshot.player.laneX);
    } else if (!snapshot.collision) {
      this.lastCollisionAt = null;
    }
    this.collisionSparks.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.disposed = true;
    for (const visual of this.trafficVisuals.values()) this.removeVisual(visual);
    this.trafficVisuals.clear();
    this.removeVisual(this.player);
    this.speedStreaks.dispose();
    this.roadHaze.dispose();
    this.tireSmoke.dispose();
    this.collisionSparks.dispose();
    this.city.dispose();
    this.roadAssets.dispose();
    this.vehicleAssets.dispose();
    this.renderer.dispose();
    this.renderer.renderLists.dispose();
  }

  private addLights(): void {
    const hemisphere = new THREE.HemisphereLight("#d7e6ff", "#111821", 2.05);
    this.scene.add(hemisphere);

    const moon = new THREE.DirectionalLight("#dce8ff", 3.65);
    moon.position.set(-14, 25, 8);
    moon.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      moon.shadow.mapSize.set(1024, 1024);
      moon.shadow.camera.left = -32;
      moon.shadow.camera.right = 32;
      moon.shadow.camera.top = 32;
      moon.shadow.camera.bottom = -32;
      moon.shadow.bias = -0.00035;
    }
    this.scene.add(moon);

    const horizon = new THREE.PointLight("#4c8dd2", 38, 155, 2);
    horizon.position.set(0, 12, -80);
    this.scene.add(horizon);
    const warmRim = new THREE.PointLight("#ffd0a0", 30, 42, 2);
    warmRim.position.set(-9, 5, 9);
    this.scene.add(warmRim);
  }

  private updateRoad(distanceMeters: number): void {
    const scroll = distanceMeters % ROAD_SEGMENT_LENGTH;
    for (let index = 0; index < this.roadSegments.length; index += 1) {
      const logicalIndex = index - 1;
      this.roadSegments[index]!.position.z = scroll - logicalIndex * ROAD_SEGMENT_LENGTH;
    }
    this.city.update(distanceMeters);
  }

  private updatePlayer(snapshot: RaceToWinSnapshot, deltaSeconds: number): void {
    const player = snapshot.player;
    const nextX = player.laneX;
    const lateralVelocity = clamp((nextX - this.previousPlayerX) / Math.max(deltaSeconds, 0.001), -12, 12);
    this.previousPlayerX = nextX;
    this.player.root.position.x = nextX;
    this.player.chassis.rotation.z = damp(this.player.chassis.rotation.z, -lateralVelocity * 0.014, deltaSeconds, 9);
    this.player.chassis.rotation.y = damp(this.player.chassis.rotation.y, lateralVelocity * 0.007, deltaSeconds, 8);
    this.player.chassis.position.y = Math.sin(snapshot.metrics.elapsedSeconds * 7.5) * 0.025;

    const wheelSpin = snapshot.metrics.speedKph * deltaSeconds * 0.08;
    for (const wheel of this.player.wheels) wheel.rotation.x -= wheelSpin;
  }

  private updateTraffic(traffic: readonly TrafficSnapshot[], speedKph: number, deltaSeconds: number): void {
    const visibleIds = new Set<number>();
    let visibleCount = 0;

    // The simulation orders far traffic first for its planner. The renderer
    // intentionally prioritizes close cars so a collision is never invisible
    // on a reduced-quality mobile scene.
    const renderableTraffic = traffic
      .filter((snapshot) => snapshot.relativeDistance >= -19 && snapshot.relativeDistance <= 205)
      .slice()
      .sort((left, right) => left.relativeDistance - right.relativeDistance);

    for (const snapshot of renderableTraffic) {
      if (visibleCount >= this.quality.trafficLimit) break;
      visibleCount += 1;
      visibleIds.add(snapshot.id);
      let visual = this.trafficVisuals.get(snapshot.id);
      if (!visual) {
        const template = this.vehicleTemplates?.traffic[
          snapshot.variantIndex % this.vehicleTemplates.traffic.length
        ];
        visual = template
          ? createModelVehicleVisual(template, false)
          : createTrafficVehicle(this.vehicleAssets, snapshot.variantIndex);
        this.trafficVisuals.set(snapshot.id, visual);
        this.scene.add(visual.root);
      }

      visual.root.visible = true;
      visual.root.position.set(snapshot.laneX, 0.03, -snapshot.relativeDistance);
      visual.chassis.position.y = Math.sin((snapshot.id + snapshot.relativeDistance) * 0.18) * 0.012;
      visual.chassis.rotation.z = 0;
      const wheelSpin = Math.max(speedKph * 0.33, snapshot.speedMps * 3.6) * deltaSeconds * 0.067;
      for (const wheel of visual.wheels) wheel.rotation.x -= wheelSpin;
    }

    for (const [id, visual] of this.trafficVisuals) {
      if (!visibleIds.has(id)) visual.root.visible = false;
    }
  }

  private updateCamera(snapshot: RaceToWinSnapshot, deltaSeconds: number): void {
    const speedProgress = clamp((snapshot.metrics.speedKph - PLAYER_START_SPEED_KPH) / (PLAYER_MAX_SPEED_KPH - PLAYER_START_SPEED_KPH), 0, 1);
    // Follow the selected lane enough to keep the complete car inside the
    // frame on a narrow mobile viewport, while still showing the road ahead.
    const desiredX = snapshot.player.laneX * 0.82;
    this.camera.position.x = damp(this.camera.position.x, desiredX, deltaSeconds, 5.8);
    this.camera.position.y = damp(this.camera.position.y, 7.22 + speedProgress * 0.34, deltaSeconds, 3);
    this.camera.position.z = damp(this.camera.position.z, 14.1 - speedProgress * 0.65, deltaSeconds, 3);
    const baseFov = this.quality.mobile ? 66 : 60;
    this.camera.fov = damp(this.camera.fov, baseFov + speedProgress * 5.2, deltaSeconds, 3.4);
    this.camera.updateProjectionMatrix();
    this.cameraLookAt.set(snapshot.player.laneX * 0.4, 1.05, -21.5 - speedProgress * 4);
    this.camera.lookAt(this.cameraLookAt);
  }

  private async loadOwnedVehicleAssets(): Promise<void> {
    const templates = await loadRaceToWinVehicleTemplates();
    if (this.disposed) return;
    this.vehicleTemplates = templates;

    if (templates.player) {
      const previous = this.player;
      const replacement = createModelVehicleVisual(templates.player, true);
      replacement.root.position.copy(previous.root.position);
      this.removeVisual(previous);
      this.player = replacement;
      this.scene.add(replacement.root);
    }

    // Existing procedural traffic is intentionally discarded so the next frame
    // rebuilds it from the owned GLB templates without retaining stale meshes.
    for (const visual of this.trafficVisuals.values()) this.removeVisual(visual);
    this.trafficVisuals.clear();
  }

  private removeVisual(visual: VehicleVisual): void {
    this.scene.remove(visual.root);
    if (isModelVehicleVisual(visual)) disposeModelVehicleVisual(visual);
  }
}
