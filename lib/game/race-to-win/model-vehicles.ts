import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { VehicleVisual } from "./vehicles";

const ASSET_ROOT = "/game/assets";

export const PLAYER_MODEL_PATH = `${ASSET_ROOT}/models/race.glb`;
export const TRAFFIC_MODEL_PATHS = [
  `${ASSET_ROOT}/models/sedan.glb`,
  `${ASSET_ROOT}/models/taxi.glb`,
  `${ASSET_ROOT}/models/van.glb`,
  `${ASSET_ROOT}/models/suv.glb`,
  `${ASSET_ROOT}/models/police.glb`,
  `${ASSET_ROOT}/models/delivery.glb`,
] as const;

export interface RaceToWinVehicleTemplates {
  readonly player: THREE.Group | null;
  readonly traffic: readonly (THREE.Group | null)[];
}

const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
  const normalized = url.replace(/\\/g, "/");
  if (normalized.startsWith("Textures/")) {
    return `${ASSET_ROOT}/textures/${normalized.slice("Textures/".length)}`;
  }
  const textureMarker = "/models/Textures/";
  const textureIndex = normalized.lastIndexOf(textureMarker);
  if (textureIndex === -1) return url;
  return `${ASSET_ROOT}/textures/${normalized.slice(textureIndex + textureMarker.length)}`;
});
const loader = new GLTFLoader(loadingManager);
const modelPromises = new Map<string, Promise<THREE.Group | null>>();

function loadModel(path: string): Promise<THREE.Group | null> {
  const existing = modelPromises.get(path);
  if (existing) return existing;

  const pending = loader.loadAsync(path)
    .then((gltf) => gltf.scene)
    // The procedural vehicle remains a safe local fallback if an owned model
    // cannot be decoded. This keeps one bad visual asset from stopping a run.
    .catch(() => null);
  modelPromises.set(path, pending);
  return pending;
}

export async function loadRaceToWinVehicleTemplates(): Promise<RaceToWinVehicleTemplates> {
  const [player, ...traffic] = await Promise.all([
    loadModel(PLAYER_MODEL_PATH),
    ...TRAFFIC_MODEL_PATHS.map((path) => loadModel(path)),
  ]);
  return { player, traffic };
}

function materialName(mesh: THREE.Mesh, material: THREE.Material): string {
  return `${mesh.name} ${material.name}`.toLowerCase();
}

function improveMaterial(mesh: THREE.Mesh, source: THREE.Material, player: boolean): THREE.Material {
  const material = source.clone();
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const name = materialName(mesh, material);
  const isGlass = /glass|window|windshield/.test(name);
  const isLight = /light|lamp|headlamp|headlight|tail/.test(name);
  const isWheel = /wheel|tire|tyre|rim/.test(name);

  if (isGlass) {
    material.color.set("#06182a");
    material.metalness = 0.55;
    material.roughness = 0.12;
  } else if (isLight) {
    const isRear = /tail|rear|brake/.test(name);
    material.color.set(isRear ? "#ff5f39" : "#dff7ff");
    material.emissive.set(isRear ? "#ff2d12" : "#73cfff");
    material.emissiveIntensity = isRear ? 2.6 : 2.1;
    material.roughness = 0.18;
  } else if (player && !isWheel) {
    const painted = new THREE.MeshPhysicalMaterial({
      color: "#e51c32", map: material.map, metalness: 0.46, roughness: 0.25,
      clearcoat: 0.95, clearcoatRoughness: 0.14, envMapIntensity: 1.16,
    });
    material.dispose();
    return painted;
  }

  return material;
}

function centerAndScale(model: THREE.Object3D, targetLength: number): void {
  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const longestAxis = Math.max(initialSize.x, initialSize.z);
  if (!Number.isFinite(longestAxis) || longestAxis <= 0.001) return;

  model.scale.multiplyScalar(targetLength / longestAxis);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= bounds.min.y;
}

interface BodySection {
  z: number;
  halfWidth: number;
  bottom: number;
  top: number;
}

/** A subdivided, closed body skin from front to rear. */
function sculptBody(sections: readonly BodySection[]): THREE.BufferGeometry {
  const profile = [
    [-0.78, 0], [-0.94, 0.14], [-1, 0.44], [-0.99, 0.67], [-0.88, 0.88],
    [-0.63, 0.98], [-0.33, 1], [0.33, 1], [0.63, 0.98], [0.88, 0.88],
    [0.99, 0.67], [1, 0.44], [0.94, 0.14], [0.78, 0], [0, 0],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const steps = 26;
  for (const [x, h] of profile) {
    const rail = new THREE.CatmullRomCurve3(sections.map(section => new THREE.Vector3(
      x * section.halfWidth, THREE.MathUtils.lerp(section.bottom, section.top, h), section.z,
    )));
    for (const point of rail.getPoints(steps)) positions.push(point.x, point.y, point.z);
  }
  for (let edge = 0; edge < profile.length; edge++) {
    const next = (edge + 1) % profile.length;
    for (let row = 0; row < steps; row++) {
      const x = edge * (steps + 1) + row;
      const y = next * (steps + 1) + row;
      indices.push(x, x + 1, y, y, x + 1, y + 1);
    }
  }
  for (let edge = 1; edge < profile.length - 1; edge++) {
    indices.push(0, edge * (steps + 1), (edge + 1) * (steps + 1));
    indices.push(steps, (edge + 1) * (steps + 1) + steps, edge * (steps + 1) + steps);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Original compact hatchback inspired by the reference, in the existing car envelope. */
function addPlayerDetails(chassis: THREE.Group, model: THREE.Object3D): void {
  const bounds = new THREE.Box3().setFromObject(model);
  const { x: width, z: length } = bounds.getSize(new THREE.Vector3());
  const originalBody = model.getObjectByName("body");
  if (originalBody) originalBody.visible = false;

  const paint = new THREE.MeshPhysicalMaterial({
    color: "#ff102d", metalness: 0.12, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.14, envMapIntensity: 0.72,
    emissive: "#d50020", emissiveIntensity: 0.38,
  });
  const carbon = new THREE.MeshPhysicalMaterial({ color: "#151820", metalness: 0.24, roughness: 0.37, clearcoat: 0.62 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#131b24", metalness: 0.12, roughness: 0.15, clearcoat: 1 });
  const chrome = new THREE.MeshStandardMaterial({ color: "#a2aab4", metalness: 0.86, roughness: 0.26 });
  const red = new THREE.MeshPhysicalMaterial({
    color: "#ff2b2c", emissive: "#ed141c", emissiveIntensity: 1.15, roughness: 0.24, clearcoat: 1,
  });
  const headlight = new THREE.MeshPhysicalMaterial({
    color: "#eaf1ff", emissive: "#dfe6ff", emissiveIntensity: 0.80, roughness: 0.19, clearcoat: 1,
  });

  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.rtwRuntimeGeometry = true;
    chassis.add(mesh);
    return mesh;
  };
  const trim = (name: string, material: THREE.Material, w: number, h: number, depth: number,
    x: number, y: number, z: number, bevel = 0.04): THREE.Mesh =>
    add(name, new RoundedBoxGeometry(w, h, depth, 2, bevel), material, x, y, z);

  const skin = (name: string, material: THREE.Material, rows: readonly (readonly [number, number, number, number])[]) =>
    add(name, sculptBody(rows.map(([z, halfWidth, bottom, top]) => ({ z: z * length, halfWidth: halfWidth * width, bottom, top }))), material, 0, 0, 0);

  skin("red-hatchback-body", paint, [
    [-0.481, .35, .52, .97], [-.432, .448, .46, 1.10], [-.25, .48, .44, 1.24],
    [-.075, .452, .45, 1.29], [.14, .449, .46, 1.31], [.32, .468, .49, 1.34],
    [.442, .447, .50, 1.37], [.481, .384, .58, 1.34],
  ]);
  skin("black-hood", carbon, [
    [-.46, .25, .94, 1.065], [-.405, .323, 1.02, 1.145],
    [-.27, .350, 1.13, 1.25], [-.163, .347, 1.20, 1.30],
  ]);
  skin("wraparound-tinted-windows", glass, [
    [-.19, .35, 1.22, 1.34], [-.10, .344, 1.25, 1.64],
    [-.008, .329, 1.29, 1.93], [.13, .335, 1.30, 1.97],
    [.247, .322, 1.29, 1.90], [.353, .327, 1.29, 1.66], [.404, .341, 1.26, 1.40],
  ]);
  skin("red-curved-roof", paint, [
    [-.041, .267, 1.79, 1.862], [.026, .305, 1.82, 1.999],
    [.15, .310, 1.82, 2.035], [.248, .294, 1.76, 1.947], [.278, .268, 1.72, 1.865],
  ]);

  const rear = length * 0.48;
  trim("rear-bumper", paint, width * .79, .27, .28, 0, .63, rear - .03, .079);
  trim("lower-black-valance", carbon, width * .69, .16, .15, 0, .55, rear + .09, .05);
  trim("registration-recess", carbon, width * .25, .145, .046, 0, .94, rear + .018);
  trim("rear-wiper", carbon, width * .27, .028, .024, width * .028, 1.43, rear - length * .11).rotation.z = .10;
  trim("subtle-black-roof-spoiler", carbon, width * .69, .073, .29, 0, 1.92, length * .265, .032);
  for(const side of [-1, 1]) {
    trim("rear-lamp-surround", carbon, width * .203, .31, .15, side * width * .318, 1.12, rear - .034, .06);
    trim("rear-red-lens", red, width * .173, .21, .065, side * width * .318, 1.14, rear + .042, .03);
    trim("rear-lens-clear-strip", headlight, width * .121, .047, .023, side * width * .318, 1.012, rear + .076, .01);
    trim("front-headlight", headlight, width * .205, .18, .10, side * width * .303, .99, -length * .475, .045);
    trim("side-sill", paint, .12, .13, length * .49, side * width * .448, .56, 0);
    trim("door-handle", carbon, .046, .052, .20, side * width * .46, 1.08, length * .095, .02);
    trim("body-colored-mirror", paint, .28, .13, .26, side * width * .413, 1.31, -length * .132, .048);
    trim("window-pillar", paint, .047, .57, .072, side * width * .334, 1.57, length * .113, .025);
  }
  add("exhaust-opening", new THREE.CircleGeometry(.066, 20), carbon, width * .249, .53, rear + .171);
  add("exhaust-edge", new THREE.TorusGeometry(.071, .012, 8, 20), chrome, width * .249, .53, rear + .182);
}

function addPlayerWheelDetails(wheel: THREE.Mesh, side: number): void {
  // These dimensions are in the source GLB’s local units and follow its wheel nodes.
  const mount = new THREE.Group();
  // Hide the old mesh via its cloned material so its children still render and rotate.
  if (Array.isArray(wheel.material)) wheel.material.forEach(material => { material.visible = false; });
  else wheel.material.visible = false;
  wheel.add(mount);
  mount.position.set(side * 0.15, 0, 0);
  const rubber = new THREE.MeshStandardMaterial({ color: "#17191f", roughness: 0.88 });
  const alloy = new THREE.MeshStandardMaterial({ color: "#9a9ca3", metalness: 0.8, roughness: 0.32 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0): void => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = x;
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = true;
    mesh.userData.rtwRuntimeGeometry = true;
    mount.add(mesh);
  };
  add(new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.15), new THREE.Vector2(0.24, -0.15),
    new THREE.Vector2(0.283, -0.13), new THREE.Vector2(0.3, -0.09),
    new THREE.Vector2(0.3, 0.09), new THREE.Vector2(0.283, 0.13),
    new THREE.Vector2(0.24, 0.15), new THREE.Vector2(0, 0.15),
  ], 32), rubber);
  add(new THREE.CylinderGeometry(.175, .175, .017, 28), rubber, side * .151);
  const ring = new THREE.TorusGeometry(.168, .017, 8, 28);
  ring.rotateY(Math.PI / 2);
  ring.rotateZ(-Math.PI / 2);
  add(ring, alloy, side * .165);
  add(new THREE.CylinderGeometry(.046, .046, .028, 20), alloy, side * .165);
  for (let index = 0; index < 7; index++) {
    const angle = index * Math.PI * 2 / 7;
    const spoke = new THREE.Mesh(new RoundedBoxGeometry(.025, .029, .137, 1, .009), alloy);
    spoke.position.set(side * .163, Math.sin(angle) * .093, Math.cos(angle) * .093);
    spoke.rotation.x = -angle;
    spoke.userData.rtwRuntimeGeometry = true;
    mount.add(spoke);
  }
}

function addRuntimeLights(chassis: THREE.Group, player: boolean): void {
  // Traffic enters and leaves every few seconds. Attaching lights to each car
  // changes Three.js light counts and recompiles scene shaders mid-race.
  // Traffic headlights remain emissive; only the persistent player adds lights.
  if (!player) return;

  const blueGlow = new THREE.PointLight("#269dff", player ? 23 : 2.4, player ? 16 : 7, 2);
  blueGlow.position.set(0, 0.65, -1.8);
  chassis.add(blueGlow);

  const rearGlow = new THREE.PointLight("#ff3045", player ? 5.5 : 1.6, player ? 10 : 4.5, 2);
  rearGlow.position.set(0, 0.72, 2.15);
  chassis.add(rearGlow);

  const beam = new THREE.SpotLight("#d7f4ff", 86, 50, Math.PI / 7, 0.72, 1.25);
  beam.position.set(0, 1.05, -2.65);
  const target = new THREE.Object3D();
  target.position.set(0, 0.1, -40);
  chassis.add(beam, target);
  beam.target = target;
}

/** Creates a per-instance visual from an owned GLB without mutating the source asset. */
export function createModelVehicleVisual(template: THREE.Group, player: boolean): VehicleVisual {
  const root = new THREE.Group();
  root.name = player ? "race-to-win-player-model" : "race-to-win-traffic-model";
  const chassis = new THREE.Group();
  const model = cloneSkinned(template);
  // The original vehicle models face positive Z; the game advances down -Z.
  model.rotation.y = Math.PI;
  centerAndScale(model, player ? 5.85 : 5.25);

  // `race.glb` includes named wheel nodes. Lift only its body to make the
  // silhouette read as a road sports car rather than an exposed F1 chassis.
  if (player) model.getObjectByName("body")?.position.add(new THREE.Vector3(0, 0.24, 0));
  const wheels: THREE.Object3D[] = [];

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => improveMaterial(object, material, player))
      : improveMaterial(object, object.material, player);
    if (/wheel-(front|back)-(left|right)/.test(object.name)) wheels.push(object);
  });

  chassis.add(model);
  if (player) {
    addPlayerDetails(chassis, model);
    for (const wheel of wheels) {
      if (wheel instanceof THREE.Mesh) addPlayerWheelDetails(wheel, wheel.name.endsWith("-left") ? 1 : -1);
    }
  }
  addRuntimeLights(chassis, player);
  root.add(chassis);
  root.userData.rtwModelVehicle = true;
  return { root, chassis, wheels };
}

/** Frees only per-instance cloned materials; template geometry stays cached and reusable. */
export function disposeModelVehicleVisual(visual: VehicleVisual): void {
  const ownedMaterials = new Set<THREE.Material>();
  visual.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) ownedMaterials.add(material);
    if (object.userData.rtwRuntimeGeometry) object.geometry.dispose();
  });
  for (const material of ownedMaterials) material.dispose();
}

export function isModelVehicleVisual(visual: VehicleVisual): boolean {
  return visual.root.userData.rtwModelVehicle === true;
}
