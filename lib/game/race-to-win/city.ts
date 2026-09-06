import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ROAD_SEGMENT_LENGTH, type RaceToWinQuality } from "./environment";

const BUILDING_ROOT = "/game/assets/buildings";
const BUILDING_PATHS = Array.from(
  { length: 7 },
  (_, index) => `${BUILDING_ROOT}/edi-${index + 1}.glb`,
);
const BILLBOARD_TEXTURE_PATH = "/images/race-to-win-city-billboard.png";

const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => {
  const normalized = url.replace(/\\/g, "/");
  if (normalized.startsWith("Textures/")) {
    return `${BUILDING_ROOT}/${normalized}`;
  }
  const marker = "/edificios/Textures/";
  const index = normalized.lastIndexOf(marker);
  return index === -1 ? url : `${BUILDING_ROOT}/Textures/${normalized.slice(index + marker.length)}`;
});

const loader = new GLTFLoader(manager);
const templatePromises = new Map<string, Promise<THREE.Group | null>>();
let billboardTexturePromise: Promise<THREE.Texture | null> | null = null;

function loadBuilding(path: string): Promise<THREE.Group | null> {
  const cached = templatePromises.get(path);
  if (cached) return cached;
  const pending = loader.loadAsync(path)
    .then((gltf) => gltf.scene)
    // A missing decorative asset must never stop the game renderer.
    .catch(() => null);
  templatePromises.set(path, pending);
  return pending;
}

function loadBillboardTexture(): Promise<THREE.Texture | null> {
  if (!billboardTexturePromise) {
    billboardTexturePromise = new THREE.TextureLoader().loadAsync(BILLBOARD_TEXTURE_PATH)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      })
      .catch(() => null);
  }
  return billboardTexturePromise;
}

function normalizeBuilding(model: THREE.Object3D, targetHeight: number): void {
  model.updateMatrixWorld(true);
  const originalBounds = new THREE.Box3().setFromObject(model);
  const originalHeight = originalBounds.max.y - originalBounds.min.y;
  if (!Number.isFinite(originalHeight) || originalHeight <= 0.001) return;

  model.scale.multiplyScalar(targetHeight / originalHeight);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= bounds.min.y;
}

function giveBuildingNightMaterials(model: THREE.Object3D): void {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = false;
    object.receiveShadow = false;
    // These templates are rescaled then moved through recycled groups. Their
    // original bounds are not representative of the final street block, so
    // retain them rather than risk a false frustum-cull at the road edge.
    object.frustumCulled = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    object.material = materials.map((source) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      // The legacy color map is a palette atlas, rather than a night facade.
      // A dark, reflective facade keeps the supplied silhouette believable;
      // dedicated window instances provide the warm Manhattan detail without
      // a field of costly dynamic point lights.
      return new THREE.MeshStandardMaterial({
        color: "#1d2e42",
        emissive: "#07101c",
        emissiveIntensity: 0.45,
        metalness: 0.74,
        roughness: 0.42,
        side: source.side,
      });
    });
  });
}

function disposeBuildingInstance(instance: THREE.Object3D): void {
  instance.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

interface BuildingSlot {
  readonly side: -1 | 1;
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly templateOffset: number;
  readonly rotation: number;
}

function slotsForSegment(segmentIndex: number): readonly BuildingSlot[] {
  const variation = Math.abs(segmentIndex) % 7;
  return [
    { side: -1, x: -15.2, z: -30, height: 58 + (variation % 3) * 9, templateOffset: variation, rotation: 0.08 },
    { side: 1, x: 15.2, z: -22, height: 66 + ((variation + 2) % 3) * 9, templateOffset: variation + 3, rotation: -0.1 },
    { side: -1, x: -21.5, z: 19, height: 82 + ((variation + 4) % 3) * 10, templateOffset: variation + 5, rotation: -0.18 },
    { side: 1, x: 21.5, z: 29, height: 76 + ((variation + 1) % 3) * 10, templateOffset: variation + 1, rotation: 0.16 },
  ];
}

function createBillboard(side: -1 | 1, z: number, texture: THREE.Texture | null): THREE.Group {
  const root = new THREE.Group();
  root.position.set(side * 13.1, 10.2, z);
  root.rotation.y = side * Math.PI * 0.5;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(7.1, 4.25, 0.24),
    new THREE.MeshStandardMaterial({ color: "#0b1119", metalness: 0.9, roughness: 0.24 }),
  );
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(6.7, 3.85),
    new THREE.MeshBasicMaterial({ map: texture ?? null, color: texture ? "#ffffff" : "#5e90c6" }),
  );
  display.position.z = 0.13;
  root.add(frame, display);
  return root;
}

function addWindowGlow(
  building: THREE.Object3D,
  side: -1 | 1,
  seed: number,
  geometry: THREE.BoxGeometry,
  material: THREE.MeshBasicMaterial,
): void {
  const bounds = new THREE.Box3().setFromObject(building);
  const depth = bounds.max.z - bounds.min.z;
  const height = bounds.max.y - bounds.min.y;
  if (depth < 1 || height < 3) return;

  const transforms: THREE.Matrix4[] = [];
  const x = side < 0 ? bounds.max.x + 0.025 : bounds.min.x - 0.025;
  const columnCount = Math.max(2, Math.min(7, Math.floor(depth / 1.85)));
  const rowCount = Math.max(3, Math.min(26, Math.floor(height / 2.05)));
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      // Leave plenty of unlit units: a uniform full facade feels synthetic.
      if ((row * 7 + column * 3 + seed) % 5 === 0) continue;
      const z = THREE.MathUtils.lerp(bounds.min.z + 0.45, bounds.max.z - 0.45, (column + 0.5) / columnCount);
      const y = 1.25 + row * Math.max(1.65, (height - 2.5) / rowCount);
      transforms.push(new THREE.Matrix4().makeTranslation(x, y, z));
    }
  }
  if (!transforms.length) return;

  const windows = new THREE.InstancedMesh(geometry, material, transforms.length);
  for (let index = 0; index < transforms.length; index += 1) windows.setMatrixAt(index, transforms[index]!);
  windows.instanceMatrix.needsUpdate = true;
  windows.frustumCulled = false;
  building.add(windows);
}

/**
 * Rendering-only, recycled city blocks. Templates and their source geometry
 * are loaded once; every visible block is a clone with its own safe material.
 */
export class RaceToWinCity {
  public readonly object = new THREE.Group();
  private readonly segments: THREE.Group[] = [];
  private readonly segmentIndices: number[] = [];
  private readonly windowGeometry = new THREE.BoxGeometry(0.036, 0.46, 0.52);
  private readonly windowMaterial = new THREE.MeshBasicMaterial({
    color: "#ffd39c",
    transparent: true,
    opacity: 0.92,
  });
  private disposed = false;

  public constructor(private readonly quality: RaceToWinQuality) {
    this.object.name = "race-to-win-nyc-city";
    for (let index = -1; index < quality.roadSegments - 1; index += 1) {
      const segment = new THREE.Group();
      segment.name = `race-to-win-city-block-${index + 1}`;
      this.segments.push(segment);
      this.segmentIndices.push(index);
      this.object.add(segment);
    }
    void this.populate();
  }

  public update(distanceMeters: number): void {
    const scroll = distanceMeters % ROAD_SEGMENT_LENGTH;
    for (let index = 0; index < this.segments.length; index += 1) {
      this.segments[index]!.position.z = scroll - this.segmentIndices[index]! * ROAD_SEGMENT_LENGTH;
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const segment of this.segments) {
      segment.traverse((object) => disposeBuildingInstance(object));
    }
    this.windowGeometry.dispose();
    this.windowMaterial.dispose();
  }

  private async populate(): Promise<void> {
    const [templates, billboardTexture] = await Promise.all([
      Promise.all(BUILDING_PATHS.map((path) => loadBuilding(path))),
      loadBillboardTexture(),
    ]);
    if (this.disposed) return;

    for (let segmentPosition = 0; segmentPosition < this.segments.length; segmentPosition += 1) {
      const segment = this.segments[segmentPosition]!;
      const logicalIndex = this.segmentIndices[segmentPosition]!;
      for (const slot of slotsForSegment(logicalIndex)) {
        const template = templates[((slot.templateOffset % templates.length) + templates.length) % templates.length];
        if (!template) continue;
        const building = cloneSkinned(template);
        normalizeBuilding(building, slot.height);
        // Preserve the supplied facades but turn their proportions into a
        // denser Manhattan-style skyline that cannot intrude into the road.
        building.scale.x *= 0.62;
        building.scale.z *= 0.72;
        building.updateMatrixWorld(true);
        giveBuildingNightMaterials(building);
        addWindowGlow(building, slot.side, logicalIndex + slot.templateOffset, this.windowGeometry, this.windowMaterial);
        building.position.set(slot.x, 0, slot.z);
        building.rotation.y = slot.rotation;
        segment.add(building);
      }

      // Sparse car-art displays give selected blocks a Times Square detail
      // while leaving the city recognizably Manhattan rather than cyberpunk.
      if (logicalIndex % 3 === 0) {
        segment.add(createBillboard(logicalIndex % 2 === 0 ? 1 : -1, -8, billboardTexture));
      }
    }
  }
}
