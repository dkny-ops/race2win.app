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

/** Geometry and materials owned by this visual instance. */
function addPlayerDetails(chassis: THREE.Group, model: THREE.Object3D): void {
  const bounds = new THREE.Box3().setFromObject(model);
  const { x: width, z: length } = bounds.getSize(new THREE.Vector3());
  const top = bounds.max.y;
  const rear = bounds.max.z;
  const paint = new THREE.MeshPhysicalMaterial({
    color: "#ae0d24", metalness: 0.51, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: "#171a20", metalness: 0.28, roughness: 0.57 });
  const titanium = new THREE.MeshStandardMaterial({ color: "#939da9", metalness: 0.89, roughness: 0.27 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#142632", metalness: 0.22, roughness: 0.17, clearcoat: 1 });
  const lens = new THREE.MeshPhysicalMaterial({
    color: "#ff293b", emissive: "#f92026", emissiveIntensity: 1.85, roughness: 0.23, clearcoat: 0.86,
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
    x: number, y: number, z: number, bevel: number): THREE.Mesh =>
    add(name, new RoundedBoxGeometry(w, h, depth, 2, bevel), material, x, y, z);

  trim("painted-rear-fascia", paint, width * 0.84, 0.49, 0.34, 0, top * 0.48, rear - 0.13, 0.095);
  trim("recessed-diffuser", carbon, width * 0.79, 0.30, 0.18, 0, top * 0.27, rear + 0.052, 0.05);
  trim("diffuser-lip", titanium, width * 0.65, 0.036, 0.09, 0, top * 0.21, rear + 0.144, 0.015);
  trim("rear-deck-vent", carbon, width * 0.47, 0.065, length * 0.14, 0, top * 0.78, rear - length * 0.29, 0.025);
  trim("tinted-rear-window", glass, width * 0.41, 0.10, length * 0.16, 0, top * 0.98, rear - length * 0.55, 0.045).rotation.x = -0.14;
  for (const side of [-1, 1]) {
    trim("tail-lamp-housing", carbon, width * 0.29, 0.15, 0.09, side * width * 0.26, top * 0.54, rear + 0.042, 0.04);
    trim("red-tail-lamp", lens, width * 0.25, 0.055, 0.063, side * width * 0.26, top * 0.55, rear + 0.098, 0.026).rotation.z = side * 0.08;
    for (const offset of [-1, 1]) {
      const x = side * width * 0.22 + offset * 0.071;
      add("exhaust-opening", new THREE.CircleGeometry(0.051, 20), carbon, x, top * 0.28, rear + 0.149);
      add("exhaust-rim", new THREE.TorusGeometry(0.055, 0.009, 6, 20), titanium, x, top * 0.28, rear + 0.157);
    }
  }
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
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 28), alloy, side * 0.151);
  add(new THREE.CylinderGeometry(0.091, 0.091, 0.024, 20), rubber, side * 0.166);
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
