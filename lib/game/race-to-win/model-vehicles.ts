import * as THREE from "three";
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
    material.color.set("#ef233c");
    material.metalness = 0.95;
    material.roughness = 0.14;
    material.emissive.set("#260006");
    material.emissiveIntensity = 0.2;
    if (material instanceof THREE.MeshPhysicalMaterial) {
      material.clearcoat = 1;
      material.clearcoatRoughness = 0.07;
    }
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

function addRuntimeLights(chassis: THREE.Group, player: boolean): void {
  const blueGlow = new THREE.PointLight("#269dff", player ? 23 : 2.4, player ? 16 : 7, 2);
  blueGlow.position.set(0, 0.65, -1.8);
  chassis.add(blueGlow);

  const rearGlow = new THREE.PointLight("#ff3045", player ? 12 : 1.6, player ? 10 : 4.5, 2);
  rearGlow.position.set(0, 0.72, 2.15);
  chassis.add(rearGlow);

  if (!player) return;
  const beam = new THREE.SpotLight("#d7f4ff", 145, 50, Math.PI / 7, 0.72, 1.25);
  beam.position.set(0, 1.05, -2.65);
  const target = new THREE.Object3D();
  target.position.set(0, 0.1, -40);
  chassis.add(beam, target);
  beam.target = target;

  // Runtime-only LED accents make the owned red car read clearly against the
  // dark city without altering the source GLB or any traffic vehicle.
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: "#ffd7dc",
    emissive: "#ff1636",
    emissiveIntensity: 4.2,
    metalness: 0.4,
    roughness: 0.2,
  });
  const rearStrip = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.1, 0.09), accentMaterial);
  rearStrip.name = "race-to-win-player-rear-led";
  rearStrip.position.set(0, 0.72, 2.86);
  rearStrip.userData.rtwRuntimeGeometry = true;
  chassis.add(rearStrip);

  for (const side of [-1, 1]) {
    const sideStripMaterial = accentMaterial.clone();
    sideStripMaterial.color.set("#c8f2ff");
    sideStripMaterial.emissive.set("#168cff");
    sideStripMaterial.emissiveIntensity = 2.1;
    const sideStrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 3.75), sideStripMaterial);
    sideStrip.name = "race-to-win-player-side-led";
    sideStrip.position.set(side * 2.34, 0.48, 0.46);
    sideStrip.userData.rtwRuntimeGeometry = true;
    chassis.add(sideStrip);
  }
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
  addRuntimeLights(chassis, player);
  root.add(chassis);
  root.userData.rtwModelVehicle = true;
  return { root, chassis, wheels };
}

/** Frees only per-instance cloned materials; template geometry stays cached and reusable. */
export function disposeModelVehicleVisual(visual: VehicleVisual): void {
  visual.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
    if (object.userData.rtwRuntimeGeometry) object.geometry.dispose();
  });
}

export function isModelVehicleVisual(visual: VehicleVisual): boolean {
  return visual.root.userData.rtwModelVehicle === true;
}
