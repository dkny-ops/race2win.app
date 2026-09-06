import * as THREE from "three";

export interface VehicleVisual {
  readonly root: THREE.Group;
  readonly chassis: THREE.Group;
  readonly wheels: readonly THREE.Object3D[];
}

interface TrafficDimensions {
  readonly width: number;
  readonly bodyHeight: number;
  readonly length: number;
  readonly cabinWidth: number;
  readonly cabinHeight: number;
  readonly cabinLength: number;
}

export interface VehicleAssets {
  readonly bodyGeometry: THREE.BoxGeometry;
  readonly hoodGeometry: THREE.BoxGeometry;
  readonly cabinGeometry: THREE.BoxGeometry;
  readonly wheelGeometry: THREE.CylinderGeometry;
  readonly rimGeometry: THREE.CylinderGeometry;
  readonly lightGeometry: THREE.BoxGeometry;
  readonly playerBody: THREE.MeshPhysicalMaterial;
  readonly playerAccent: THREE.MeshPhysicalMaterial;
  readonly trafficBodies: readonly THREE.MeshStandardMaterial[];
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly tire: THREE.MeshStandardMaterial;
  readonly rim: THREE.MeshStandardMaterial;
  readonly headlight: THREE.MeshStandardMaterial;
  readonly taillight: THREE.MeshStandardMaterial;
  dispose(): void;
}

const TRAFFIC_COLOURS = ["#365875", "#d77d2a", "#56616e", "#d4d8df"] as const;

function makeMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number],
  scale: readonly [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addWheel(
  parent: THREE.Group,
  assets: VehicleAssets,
  x: number,
  z: number,
  wheelScale = 1,
): THREE.Group {
  const wheel = new THREE.Group();
  wheel.position.set(x, 0.4, z);

  const tire = makeMesh(assets.wheelGeometry, assets.tire, [0, 0, 0], [wheelScale, wheelScale, wheelScale]);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  wheel.add(tire);

  const outerRim = makeMesh(assets.rimGeometry, assets.rim, [0, 0, 0], [wheelScale, wheelScale, wheelScale]);
  outerRim.rotation.z = Math.PI / 2;
  wheel.add(outerRim);

  parent.add(wheel);
  return wheel;
}

function addLights(
  parent: THREE.Group,
  assets: VehicleAssets,
  width: number,
  length: number,
): void {
  for (const x of [-width * 0.31, width * 0.31]) {
    const headlight = makeMesh(assets.lightGeometry, assets.headlight, [x, 0.78, -length / 2 - 0.025], [0.76, 0.34, 0.36]);
    const taillight = makeMesh(assets.lightGeometry, assets.taillight, [x, 0.75, length / 2 + 0.025], [0.75, 0.3, 0.28]);
    parent.add(headlight, taillight);
  }
}

function trafficDimensions(variantIndex: number): TrafficDimensions {
  switch (variantIndex % TRAFFIC_COLOURS.length) {
    case 1:
      return { width: 2.95, bodyHeight: 0.48, length: 5.15, cabinWidth: 2.06, cabinHeight: 0.67, cabinLength: 2.22 };
    case 2:
      return { width: 3.15, bodyHeight: 0.67, length: 5.48, cabinWidth: 2.42, cabinHeight: 0.82, cabinLength: 2.46 };
    case 3:
      return { width: 3.08, bodyHeight: 0.72, length: 5.7, cabinWidth: 2.55, cabinHeight: 1.14, cabinLength: 2.72 };
    default:
      return { width: 2.9, bodyHeight: 0.47, length: 5.2, cabinWidth: 2.04, cabinHeight: 0.66, cabinLength: 2.26 };
  }
}

export function createVehicleAssets(): VehicleAssets {
  const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
  const hoodGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cabinGeometry = new THREE.BoxGeometry(1, 1, 1);
  const wheelGeometry = new THREE.CylinderGeometry(0.72, 0.72, 0.48, 16);
  const rimGeometry = new THREE.CylinderGeometry(0.39, 0.39, 0.495, 12);
  const lightGeometry = new THREE.BoxGeometry(1, 1, 1);

  const materials: THREE.Material[] = [];
  const track = <T extends THREE.Material>(material: T): T => {
    materials.push(material);
    return material;
  };

  const assets: VehicleAssets = {
    bodyGeometry,
    hoodGeometry,
    cabinGeometry,
    wheelGeometry,
    rimGeometry,
    lightGeometry,
    playerBody: track(new THREE.MeshPhysicalMaterial({
      color: "#b50918",
      metalness: 0.95,
      roughness: 0.14,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
    })),
    playerAccent: track(new THREE.MeshPhysicalMaterial({
      color: "#f02a35",
      metalness: 0.9,
      roughness: 0.17,
      clearcoat: 1,
      clearcoatRoughness: 0.09,
    })),
    trafficBodies: TRAFFIC_COLOURS.map((colour) => track(new THREE.MeshStandardMaterial({
      color: colour,
      metalness: 0.62,
      roughness: 0.35,
    }))),
    glass: track(new THREE.MeshPhysicalMaterial({
      color: "#061d32",
      metalness: 0.5,
      roughness: 0.12,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    })),
    tire: track(new THREE.MeshStandardMaterial({ color: "#05070b", metalness: 0.15, roughness: 0.88 })),
    rim: track(new THREE.MeshStandardMaterial({ color: "#9cc7e6", metalness: 0.92, roughness: 0.24 })),
    headlight: track(new THREE.MeshStandardMaterial({
      color: "#dff6ff",
      emissive: "#8bdcff",
      emissiveIntensity: 2.8,
      metalness: 0.15,
      roughness: 0.15,
    })),
    taillight: track(new THREE.MeshStandardMaterial({
      color: "#ff5a31",
      emissive: "#ff260d",
      emissiveIntensity: 2.15,
      metalness: 0.15,
      roughness: 0.22,
    })),
    dispose() {
      bodyGeometry.dispose();
      hoodGeometry.dispose();
      cabinGeometry.dispose();
      wheelGeometry.dispose();
      rimGeometry.dispose();
      lightGeometry.dispose();
      for (const material of materials) material.dispose();
    },
  };

  return assets;
}

/** A local, procedural metallic-red sports car used while no owned GLB model is available. */
export function createPlayerVehicle(assets: VehicleAssets): VehicleVisual {
  const root = new THREE.Group();
  root.name = "race-to-win-player-car";
  const chassis = new THREE.Group();
  root.add(chassis);

  chassis.add(
    makeMesh(assets.bodyGeometry, assets.playerBody, [0, 0.75, 0], [3.3, 0.5, 5.85]),
    makeMesh(assets.hoodGeometry, assets.playerAccent, [0, 1.06, -1.2], [3.08, 0.25, 2.24]),
    makeMesh(assets.cabinGeometry, assets.glass, [0, 1.34, 0.56], [2.26, 0.76, 2.52]),
  );

  const splitter = makeMesh(assets.hoodGeometry, assets.playerAccent, [0, 0.48, -2.98], [2.86, 0.13, 0.34]);
  chassis.add(splitter);
  addLights(chassis, assets, 3.3, 5.85);

  const wheels = [
    addWheel(chassis, assets, -1.75, -1.9, 1.12),
    addWheel(chassis, assets, 1.75, -1.9, 1.12),
    addWheel(chassis, assets, -1.75, 1.9, 1.12),
    addWheel(chassis, assets, 1.75, 1.9, 1.12),
  ];

  const underglow = new THREE.PointLight("#148dff", 20, 13, 2);
  underglow.position.set(0, 0.35, 0.45);
  chassis.add(underglow);

  const beam = new THREE.SpotLight("#87d8ff", 120, 42, Math.PI / 8, 0.7, 1.3);
  beam.position.set(0, 1.05, -2.55);
  beam.castShadow = false;
  const beamTarget = new THREE.Object3D();
  beamTarget.position.set(0, 0, -34);
  root.add(beam, beamTarget);
  beam.target = beamTarget;

  return { root, chassis, wheels };
}

/** Lightweight local traffic variants. They intentionally do not load remote models. */
export function createTrafficVehicle(assets: VehicleAssets, variantIndex: number): VehicleVisual {
  const root = new THREE.Group();
  root.name = `race-to-win-traffic-${variantIndex % TRAFFIC_COLOURS.length}`;
  const chassis = new THREE.Group();
  root.add(chassis);
  const dimensions = trafficDimensions(variantIndex);
  const bodyMaterial = assets.trafficBodies[variantIndex % assets.trafficBodies.length]!;

  chassis.add(
    makeMesh(assets.bodyGeometry, bodyMaterial, [0, dimensions.bodyHeight / 2 + 0.42, 0], [dimensions.width, dimensions.bodyHeight, dimensions.length]),
    makeMesh(assets.hoodGeometry, bodyMaterial, [0, dimensions.bodyHeight + 0.6, -dimensions.length * 0.21], [dimensions.width * 0.91, 0.2, dimensions.length * 0.31]),
    makeMesh(assets.cabinGeometry, assets.glass, [0, dimensions.bodyHeight + dimensions.cabinHeight / 2 + 0.53, dimensions.length * 0.08], [dimensions.cabinWidth, dimensions.cabinHeight, dimensions.cabinLength]),
  );

  if (variantIndex % TRAFFIC_COLOURS.length === 3) {
    chassis.add(makeMesh(assets.cabinGeometry, bodyMaterial, [0, 1.9, 0.7], [dimensions.cabinWidth * 0.99, 0.66, dimensions.cabinLength * 0.63]));
  }

  addLights(chassis, assets, dimensions.width, dimensions.length);
  const wheelZ = dimensions.length * 0.33;
  const wheelX = dimensions.width * 0.56;
  const wheels = [
    addWheel(chassis, assets, -wheelX, -wheelZ),
    addWheel(chassis, assets, wheelX, -wheelZ),
    addWheel(chassis, assets, -wheelX, wheelZ),
    addWheel(chassis, assets, wheelX, wheelZ),
  ];

  return { root, chassis, wheels };
}
