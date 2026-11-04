import * as THREE from "three";

export const ROAD_SEGMENT_LENGTH = 96;
export const ROAD_WIDTH = 18;

export interface RaceToWinQuality {
  readonly mobile: boolean;
  readonly shadows: boolean;
  readonly roadSegments: number;
  readonly trafficLimit: number;
  readonly particleCount: number;
  readonly pixelRatioCap: number;
}

export interface RoadAssets {
  readonly roadGeometry: THREE.PlaneGeometry;
  readonly shoulderGeometry: THREE.BoxGeometry;
  readonly markingGeometry: THREE.BoxGeometry;
  readonly railGeometry: THREE.BoxGeometry;
  readonly postGeometry: THREE.BoxGeometry;
  readonly lampGeometry: THREE.BoxGeometry;
  readonly roadMaterial: THREE.MeshStandardMaterial;
  readonly shoulderMaterial: THREE.MeshStandardMaterial;
  readonly markingMaterial: THREE.MeshStandardMaterial;
  readonly railMaterial: THREE.MeshStandardMaterial;
  readonly postMaterial: THREE.MeshStandardMaterial;
  readonly blueLampMaterial: THREE.MeshStandardMaterial;
  readonly orangeLampMaterial: THREE.MeshStandardMaterial;
  dispose(): void;
}

function pseudoRandom(index: number): number {
  const value = Math.sin(index * 91.391 + 17.33) * 43758.5453123;
  return value - Math.floor(value);
}

function staticMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number],
  scale: readonly [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.receiveShadow = true;
  return mesh;
}

export function createRoadAssets(): RoadAssets {
  const geometry: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const collectGeometry = <T extends THREE.BufferGeometry>(item: T): T => {
    geometry.push(item);
    return item;
  };
  const collectMaterial = <T extends THREE.Material>(item: T): T => {
    materials.push(item);
    return item;
  };
  // Sample only unmarked asphalt from the existing artwork, in memory.
  // The source PNG is never rewritten and lane markings remain 3D geometry.
  let disposed = false;
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 512;
  const fallback = canvas.getContext("2d");
  if (fallback) { fallback.fillStyle = "#666c74"; fallback.fillRect(0, 0, canvas.width, canvas.height); }
  const asphalt = new THREE.CanvasTexture(canvas);
  new THREE.TextureLoader().load("/images/Race123.PNG", (source) => {
    if (disposed) { source.dispose(); return; }
    const context = canvas.getContext("2d");
    if (context) {
      // Mirror the patch in both axes so repeat boundaries meet seamlessly.
      for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
        context.save();
        context.translate(column === 0 ? 0 : 256, row === 0 ? 0 : 512);
        context.scale(column === 0 ? 1 : -1, row === 0 ? 1 : -1);
        context.drawImage(source.image, 745, 680, 90, 250, 0, 0, 128, 256);
        context.restore();
      }
      asphalt.needsUpdate = true;
    }
    source.dispose();
  });
  asphalt.colorSpace = THREE.SRGBColorSpace;
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.repeat.set(2, 4);

  return {
    roadGeometry: collectGeometry(new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_SEGMENT_LENGTH)),
    shoulderGeometry: collectGeometry(new THREE.BoxGeometry(1, 1, 1)),
    markingGeometry: collectGeometry(new THREE.BoxGeometry(1, 1, 1)),
    railGeometry: collectGeometry(new THREE.BoxGeometry(1, 1, 1)),
    postGeometry: collectGeometry(new THREE.BoxGeometry(1, 1, 1)),
    lampGeometry: collectGeometry(new THREE.BoxGeometry(1, 1, 1)),
    roadMaterial: collectMaterial(new THREE.MeshStandardMaterial({ color: "#b5b5b5", map: asphalt, roughness: 0.96, metalness: 0.02 })),
    shoulderMaterial: collectMaterial(new THREE.MeshStandardMaterial({ color: "#e9c87c", roughness: 1, metalness: 0 })),
    markingMaterial: collectMaterial(new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
    })),
    railMaterial: collectMaterial(new THREE.MeshStandardMaterial({ color: "#f6f6f1", roughness: 0.9, metalness: 0 })),
    postMaterial: collectMaterial(new THREE.MeshStandardMaterial({ color: "#e63c38", roughness: 0.85, metalness: 0 })),
    blueLampMaterial: collectMaterial(new THREE.MeshStandardMaterial({ color: "#d8efff", emissive: "#438fd7", emissiveIntensity: 3.1 })),
    orangeLampMaterial: collectMaterial(new THREE.MeshStandardMaterial({ color: "#fff0d3", emissive: "#ffad5c", emissiveIntensity: 3.5 })),
    dispose() {
      disposed = true;
      asphalt.dispose();
      for (const item of geometry) item.dispose();
      for (const item of materials) item.dispose();
    },
  };
}

export function createRoadSegment(assets: RoadAssets, segmentIndex: number): THREE.Group {
  const root = new THREE.Group();
  root.name = `race-to-win-road-${segmentIndex}`;

  const road = staticMesh(assets.roadGeometry, assets.roadMaterial, [0, 0, 0]);
  road.rotation.x = -Math.PI / 2;
  root.add(road);

  const edgePaint = assets.orangeLampMaterial;
  edgePaint.color.set("#ffd52a");
  edgePaint.emissive.set("#000000");
  for (const side of [-1, 1]) {
    root.add(staticMesh(assets.markingGeometry, edgePaint, [side * 8.65, 0.065, 0], [0.17, 0.045, ROAD_SEGMENT_LENGTH]));
  }

  for (const x of [-10.2, 10.2]) {
    root.add(staticMesh(assets.shoulderGeometry, assets.shoulderMaterial, [x, 0.04, 0], [2.45, 0.1, ROAD_SEGMENT_LENGTH]));
  }

  for (let z = -42; z <= 42; z += 12) {
    for (const x of [-2.5, 2.5]) {
      root.add(staticMesh(assets.markingGeometry, assets.markingMaterial, [x, 0.065, z], [0.19, 0.045, 6.2]));
    }
  }

  // Alternating red-and-white safety barriers like the coastal reference.
  for (let z = -46; z < 48; z += 4) {
    for (const side of [-1, 1]) {
      const material = Math.floor((z + 46) / 4) % 2 === 0 ? assets.postMaterial : assets.railMaterial;
      root.add(staticMesh(assets.shoulderGeometry, material, [side * 10.15, 0.43, z + 2], [0.55, 0.85, 3.98]));
    }
  }

  return root;
}

export class SpeedStreakSystem {
  public readonly object: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly slots: readonly { x: number; y: number; offset: number; length: number }[];

  public constructor(count: number) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 2 * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.LineBasicMaterial({ color: "#78cfff", transparent: true, opacity: 0.28, depthWrite: false });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.frustumCulled = false;
    this.slots = Array.from({ length: count }, (_, index) => ({
      x: (pseudoRandom(index + 80) - 0.5) * 36,
      y: 0.3 + pseudoRandom(index + 120) * 7.5,
      offset: pseudoRandom(index + 200) * 180,
      length: 3 + pseudoRandom(index + 240) * 10,
    }));
  }

  public update(distanceMeters: number, speedKph: number): void {
    const intensity = Math.min(Math.max((speedKph - 95) / 72, 0), 1);
    this.object.visible = intensity > 0.04;
    const material = this.object.material as THREE.LineBasicMaterial;
    material.opacity = 0.08 + intensity * 0.28;
    const motion = distanceMeters * (0.85 + intensity * 0.45);
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index]!;
      const z = -((slot.offset + motion) % 185) - 5;
      const start = index * 6;
      this.positions[start] = slot.x;
      this.positions[start + 1] = slot.y;
      this.positions[start + 2] = z;
      this.positions[start + 3] = slot.x;
      this.positions[start + 4] = slot.y;
      this.positions[start + 5] = z - slot.length * (0.6 + intensity);
    }
    (this.object.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

/** Subtle sunlit road dust, without a costly post-processing pass. */
export class RoadHazeSystem {
  public readonly object: THREE.Points;
  private readonly positions: Float32Array;
  private readonly slots: readonly { x: number; y: number; offset: number }[];

  public constructor(count: number) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color: "#e7dfca",
      size: 0.18,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.object = new THREE.Points(geometry, material);
    this.object.frustumCulled = false;
    this.slots = Array.from({ length: count }, (_, index) => ({
      x: (pseudoRandom(index + 310) - 0.5) * 24,
      y: 0.18 + pseudoRandom(index + 340) * 2.5,
      offset: pseudoRandom(index + 370) * 170,
    }));
  }

  public update(distanceMeters: number, speedKph: number): void {
    const drift = distanceMeters * (0.12 + Math.min(speedKph / 3000, 0.08));
    const material = this.object.material as THREE.PointsMaterial;
    material.opacity = 0.025 + Math.min(Math.max((speedKph - 90) / 110, 0), 1) * 0.025;
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index]!;
      const z = -((slot.offset + drift) % 175) - 3;
      const start = index * 3;
      this.positions[start] = slot.x;
      this.positions[start + 1] = slot.y;
      this.positions[start + 2] = z;
    }
    (this.object.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

/** Short-lived local tire haze. It is visual-only and never feeds simulation. */
export class TireSmokeSystem {
  public readonly object: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private cursor = 0;

  public constructor(count: number) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.ages = new Float32Array(count).fill(Number.POSITIVE_INFINITY);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.object = new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#bfd0dd", size: 0.72, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }));
    this.object.frustumCulled = false;
  }

  public trigger(laneX: number, laneChange: boolean): void {
    const amount = laneChange ? 4 : 6;
    for (let index = 0; index < amount; index += 1) {
      const slot = this.cursor++ % this.ages.length;
      const start = slot * 3;
      const side = index % 2 === 0 ? -1 : 1;
      this.positions[start] = laneX + side * (0.55 + (index % 2) * 0.09);
      this.positions[start + 1] = 0.12 + (index % 3) * 0.035;
      this.positions[start + 2] = 1.05 + (index % 3) * 0.08;
      this.velocities[start] = side * (laneChange ? 1.8 : 0.85) + (index % 3 - 1) * 0.16;
      this.velocities[start + 1] = 0.24 + (index % 3) * 0.1;
      this.velocities[start + 2] = 0.9 + (index % 3) * 0.15;
      this.ages[slot] = 0;
    }
    this.object.visible = true;
  }

  public update(deltaSeconds: number): void {
    let active = 0;
    for (let index = 0; index < this.ages.length; index += 1) {
      if (!Number.isFinite(this.ages[index])) continue;
      this.ages[index] += deltaSeconds;
      if (this.ages[index] > 0.36) { this.ages[index] = Number.POSITIVE_INFINITY; continue; }
      active += 1;
      const start = index * 3;
      this.positions[start] += this.velocities[start]! * deltaSeconds;
      this.positions[start + 1] += this.velocities[start + 1]! * deltaSeconds;
      this.positions[start + 2] += this.velocities[start + 2]! * deltaSeconds;
      this.velocities[start + 1] += 0.45 * deltaSeconds;
    }
    (this.object.material as THREE.PointsMaterial).opacity = active ? 0.13 : 0;
    this.object.visible = active > 0;
    (this.object.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void { this.object.geometry.dispose(); (this.object.material as THREE.Material).dispose(); }
}

export class CollisionSparks {
  public readonly object: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private age = Number.POSITIVE_INFINITY;

  public constructor(count: number) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({ color: "#ff9d36", size: 0.38, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.object = new THREE.Points(geometry, material);
    this.object.frustumCulled = false;
  }

  public trigger(x: number): void {
    this.age = 0;
    for (let index = 0; index < this.positions.length / 3; index += 1) {
      const spin = index * 1.73;
      const start = index * 3;
      this.positions[start] = x + Math.sin(spin) * 0.35;
      this.positions[start + 1] = 0.8 + (index % 5) * 0.11;
      this.positions[start + 2] = -0.8 + Math.cos(spin) * 0.3;
      this.velocities[start] = Math.sin(spin) * (4 + (index % 7));
      this.velocities[start + 1] = 2.2 + (index % 6) * 0.56;
      this.velocities[start + 2] = -2 - (index % 8) * 0.8;
    }
    this.object.visible = true;
  }

  public update(deltaSeconds: number): void {
    if (!Number.isFinite(this.age)) return;
    this.age += deltaSeconds;
    const material = this.object.material as THREE.PointsMaterial;
    material.opacity = Math.max(0, 1 - this.age / 0.9);
    for (let index = 0; index < this.positions.length / 3; index += 1) {
      const start = index * 3;
      this.positions[start] += this.velocities[start]! * deltaSeconds;
      this.positions[start + 1] += this.velocities[start + 1]! * deltaSeconds;
      this.positions[start + 2] += this.velocities[start + 2]! * deltaSeconds;
      this.velocities[start + 1] -= 8.2 * deltaSeconds;
    }
    (this.object.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    if (this.age > 0.9) this.object.visible = false;
  }

  public dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
