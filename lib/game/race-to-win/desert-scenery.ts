import * as THREE from "three";
import { ROAD_WIDTH, type RaceToWinQuality } from "./environment";

const RECYCLE_AT = 56;
const VIEW_LENGTH = 800;
const SHOULDER = ROAD_WIDTH / 2;
export const DESERT_HAZE = "#dfba9d";

interface Placement {
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  yaw: number;
}

function variation(index: number): number {
  const value = Math.sin(index * 12.9898 + 4.173) * 43758.5453;
  return value - Math.floor(value);
}

export function createDesertSky(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const sky = canvas.getContext("2d")!;
  const gradient = sky.createLinearGradient(0, 0, 0, 1024);
  gradient.addColorStop(0, "#276187");
  gradient.addColorStop(0.31, "#719ebb");
  gradient.addColorStop(0.43, "#b3c1c7");
  gradient.addColorStop(0.50, DESERT_HAZE);
  gradient.addColorStop(1, DESERT_HAZE);
  sky.fillStyle = gradient;
  sky.fillRect(0, 0, 2048, 1024);

  // Repeat the subtle sky features around the sphere so camera tracking stays seamless.
  for (let index = 0; index < 32; index++) {
    const x = variation(index + 300) * 2048;
    const y = 418 + variation(index + 700) * 66;
    const width = 22 + variation(index + 500) * 102;
    const height = 2 + variation(index + 600) * 6;
    for (const shifted of [x - 2048, x, x + 2048]) {
      sky.save();
      sky.translate(shifted, y);
      sky.rotate((variation(index + 900) - 0.5) * 0.12);
      sky.scale(1, height / width);
      const cloud = sky.createRadialGradient(0, 0, 0, 0, 0, width);
      cloud.addColorStop(0, "rgba(255,224,189,0.52)");
      cloud.addColorStop(0.38, "rgba(255,218,183,0.33)");
      cloud.addColorStop(1, "rgba(255,218,183,0)");
      sky.fillStyle = cloud;
      sky.fillRect(-width, -width, width * 2, width * 2);
      sky.restore();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

function mesaGeometry(seed: number, mobile: boolean): THREE.BufferGeometry {
  const profile = [
    [0, 1.00], [0.10, 0.96], [0.22, 0.80], [0.39, 0.67],
    [0.47, 0.61], [0.53, 0.69], [0.58, 0.62], [0.65, 0.64],
    [0.74, 0.56], [0.79, 0.60], [0.84, 0.51], [0.91, 0.48],
    [0.95, 0.36], [1.00, 0.20],
  ];
  const sides = mobile ? 22 : 33;
  const positions: number[] = [];
  const textureUV: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  for (const [row, [height, radius]] of profile.entries()) {
    for (let side = 0; side <= sides; side++) {
      const angle = (side % sides) * Math.PI * 2 / sides;
      const rib = 1 + 0.20 * Math.sin(angle * 3 + seed) + 0.12 * Math.cos(angle * 7 + seed)
        + 0.10 * Math.sin(angle * 11 + height * 6 + seed);
      const ledge = 0.026 * Math.sin(angle * 3 + seed) * Math.sin(height * Math.PI);
      positions.push(Math.cos(angle) * radius * rib + height * 0.18, height + ledge, Math.sin(angle) * radius * rib);
      textureUV.push(side / sides * 5, height * 2.8 + ledge);
      const shade = 0.78 + variation(row + seed * 13) * 0.20 - 0.13 * Number(row === 4 || row === 8);
      colors.push(shade, shade * 0.98, shade * 0.94);
      if (row === 0 || side === sides) continue;
      const upper = row * (sides + 1) + side;
      const lower = upper - sides - 1;
      indices.push(lower, upper, lower + 1, lower + 1, upper, upper + 1);
    }
  }
  const cap = positions.length / 3;
  positions.push(0.18, 1.01, 0);
  textureUV.push(2.5, 2.8);
  colors.push(0.95, 0.93, 0.89);
  for (let side = 0; side < sides; side++) {
    const edge = cap - sides - 1 + side;
    indices.push(edge, cap, edge + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(textureUV, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function scrubGeometry(mobile: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const blades = mobile ? 19 : 32;
  for (let index = 0; index < blades; index++) {
    const angle = index * 2.399963;
    const height = 0.30 + variation(index + 423) * 0.66;
    const spread = 0.23 + variation(index + 371) * 0.68;
    const x = Math.cos(angle) * spread;
    const z = Math.sin(angle) * spread;
    const dx = Math.sin(angle) * 0.028;
    const dz = Math.cos(angle) * 0.028;
    const middle = [x * 0.52, height * 0.65, z * 0.52];
    positions.push(-dx, 0, dz, dx, 0, -dz, ...middle, ...middle, x, height, z, middle[0] + dx, middle[1] - 0.045, middle[2] - dz);
    colors.push(0.25, 0.21, 0.12, 0.28, 0.24, 0.13, 0.51, 0.44, 0.24,
      0.51, 0.44, 0.24, 0.77, 0.67, 0.39, 0.56, 0.43, 0.19);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export class DesertScenery {
  public readonly object = new THREE.Group();
  private readonly owned = new Set<{ dispose(): void }>();
  private readonly distance = { value: 0 };
  private readonly transform = new THREE.Object3D();
  private readonly batches: { mesh: THREE.InstancedMesh; placements: Placement[] }[] = [];

  public constructor(quality: RaceToWinQuality) {
    this.object.name = "red-rock-desert";
    const gravel = this.texture("gravel", quality);
    const sand = this.texture("sand", quality);
    const sandstone = this.texture("cliff", quality);
    const boulder = this.texture("boulder", quality);
    this.addGround(gravel, sand, quality.shadows);

    const rockMaterial = this.own(new THREE.MeshStandardMaterial({
      map: sandstone, bumpMap: sandstone, bumpScale: 0.30, color: "#c99073", roughness: 1, vertexColors: true,
    }));
    for (let group = 0; group < 3; group++) {
      const geometry = this.own(mesaGeometry(group + 3, quality.mobile));
      const cliffs = Array.from({ length: 13 }, (_, index) => {
        const seed = index + group * 27;
        const width = 13 + variation(seed + 80) * 17;
        const length = 25 + variation(seed + 70) * 19;
        const yaw = (variation(seed + 530) - 0.5) * 0.32;
        return {
          x: -SHOULDER - (group === 0 ? 3 : 24 + group * 5) - width * 1.42 - length * 0.16 - variation(seed + 44) * 7,
          z: index * VIEW_LENGTH / 13 + (group - 1) * 19 + variation(seed + 32) * 12,
          width, length,
          height: (group === 0 ? 15 : 24) + variation(seed + 190) * 19,
          yaw,
        };
      });
      this.addBatch(geometry, rockMaterial, cliffs, quality.shadows && group === 0, false);
    }

    // These rock formations lie beyond the roadside props, with a separate haze layer.
    const skyline = this.own(mesaGeometry(11, quality.mobile));
    const distantRock = this.own(new THREE.MeshStandardMaterial({
      map: sandstone, color: "#ae8175", roughness: 1, vertexColors: true,
    }));
    const horizon = [
      [135, -245, 38, 43, 29, 1.0], [101, -390, 23, 50, 32, 0.6], [200, -345, 67, 45, 49, 0.3],
      [288, -458, 91, 76, 57, 0.9], [40, -507, 19, 45, 30, 0.2], [-118, -465, 73, 71, 37, 1.4],
    ].map(([x,z,width,length,height,yaw]) => ({x,z,width,length,height,yaw}));
    const skylineMesh = new THREE.InstancedMesh(skyline, distantRock, horizon.length);
    this.own(skylineMesh);
    this.object.add(skylineMesh);
    this.place(skylineMesh, horizon, null);

    const boulders = Array.from({ length: quality.mobile ? 61 : 94 }, (_, index) => {
      const side = index % 3 === 0 ? 1 : -1;
      const width = 0.28 + variation(index + 64) * 1.35;
      return {
        x: side * (SHOULDER + width * 1.3 + 1.4 + variation(index + 209) * 23),
        z: index * 790 / (quality.mobile ? 61 : 94) + variation(index + 12) * 8,
        width, length: width * (0.69 + variation(index + 45) * 0.59),
        height: width * (0.49 + variation(index + 89) * 0.48),
        yaw: variation(index + 25) * 6.28,
      };
    });
    const boulderGeo = this.own(new THREE.DodecahedronGeometry(1, quality.mobile ? 0 : 1));
    const boulderPosition = boulderGeo.getAttribute("position");
    for (let index = 0; index < boulderPosition.count; index++) {
      const x = boulderPosition.getX(index);
      const y = boulderPosition.getY(index);
      const z = boulderPosition.getZ(index);
      const contour = 1 + 0.11 * Math.sin(10 * x + 7 * z) + 0.11 * Math.cos(6 * y - 14 * z);
      boulderPosition.setXYZ(index, x * contour, 0.54 + y * contour * 0.59, z * contour);
    }
    boulderGeo.computeVertexNormals();
    this.addBatch(boulderGeo, this.own(new THREE.MeshStandardMaterial({
      map: boulder, bumpMap: boulder, bumpScale: 0.10, color: "#e6a181", roughness: 1,
    })), boulders, quality.shadows);

    const scrubCount = quality.mobile ? 135 : 226;
    const scrub = Array.from({ length: scrubCount }, (_, index) => {
      const side = index % 3 === 0 ? -1 : 1;
      const width = 0.34 + variation(index + 432) * 0.89;
      return {
        x: side * (SHOULDER + 1.9 + 49 * Math.pow(variation(index + 98), 1.5)),
        z: index * VIEW_LENGTH / scrubCount + variation(index + 105) * 13,
        width, length: width * (0.65 + variation(index + 500) * 0.61),
        height: width * (0.39 + variation(index + 205) * 0.52),
        yaw: variation(index + 444) * 6.28,
      };
    });
    this.addBatch(this.own(scrubGeometry(quality.mobile)), this.own(new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide, vertexColors: true, color: "#ccbd8f", roughness: 1,
    })), scrub, false);

    // Soft ground contact remains available at mobile quality, where shadow maps are disabled.
    this.addContactShadows([...boulders, ...scrub], quality.mobile);
    this.update(0);
  }

  public update(distanceMeters: number): void {
    this.distance.value = distanceMeters;
    for (const { mesh, placements } of this.batches) this.place(mesh, placements, distanceMeters);
  }

  public dispose(): void {
    for (const item of this.owned) item.dispose();
  }

  private own<T extends { dispose(): void }>(item: T): T {
    this.owned.add(item);
    return item;
  }

  private texture(name: string, quality: RaceToWinQuality): THREE.Texture {
    const texture = this.own(new THREE.TextureLoader().load("/images/desert-" + name + ".webp"));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.anisotropy = quality.mobile ? 2 : 8;
    return texture;
  }

  private addGround(gravel: THREE.Texture, sand: THREE.Texture, shadows: boolean): void {
    const floor = this.own(new THREE.PlaneGeometry(1140, 850));
    floor.rotateX(-Math.PI / 2);
    floor.translate(250, -0.045, -345);
    const material = this.own(new THREE.MeshStandardMaterial({ color: "#e2a77a", roughness: 0.97 }));
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { desertDistance: this.distance, gravel: { value: gravel }, sand: { value: sand } });
      shader.vertexShader = "varying vec2 desertXZ;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\ndesertXZ = position.xz;",
      );
      shader.fragmentShader = "uniform float desertDistance;\nuniform sampler2D gravel, sand;\nvarying vec2 desertXZ;\n" + shader.fragmentShader.replace(
        "#include <color_fragment>", [
          "#include <color_fragment>",
          "vec2 desertSample = desertXZ - vec2(0.0, desertDistance);",
          "vec3 grit = texture2D(gravel, desertSample / 5.5).rgb;",
          "vec3 dust = texture2D(sand, desertSample / 9.0).rgb;",
          "float mottling = texture2D(gravel, desertSample.yx / 47.0).r;",
          "float verge = smoothstep(9.3, 17.0, abs(desertXZ.x));",
          "diffuseColor.rgb *= mix(dust, grit, smoothstep(0.14, 0.62, mottling + verge * 0.15)) * (0.76 + mottling * 0.48);",
        ].join("\n"),
      );
    };
    const ground = new THREE.Mesh(floor, material);
    ground.receiveShadow = shadows;
    this.object.add(ground);
  }

  private addContactShadows(placements: Placement[], mobile: boolean): void {
    const geometry = this.own(new THREE.PlaneGeometry(2.6, 2.4));
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0.014, 0);
    const shadow = this.own(new THREE.MeshBasicMaterial({
      color: "#2c1710", transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }));
    shadow.onBeforeCompile = shader => {
      shader.vertexShader = "varying vec2 dustShadowUV;\n" + shader.vertexShader.replace(
        "#include <uv_vertex>", "#include <uv_vertex>\ndustShadowUV = uv;",
      );
      shader.fragmentShader = "varying vec2 dustShadowUV;\n" + shader.fragmentShader.replace(
        "#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= 0.42 * (1.0 - smoothstep(0.10, 0.50, length(dustShadowUV - 0.5)));",
      );
    };
    this.addBatch(geometry, shadow, placements.map(placement => ({
      ...placement, x: placement.x - 0.35 * placement.height, z: placement.z + 0.26 * placement.height,
      yaw: -0.78, width: placement.width * (mobile ? 1.24 : 1.09), height: 1,
    })), false);
  }

  private addBatch(
    geometry: THREE.BufferGeometry, material: THREE.Material, placements: Placement[], shadows: boolean, receiveShadow = true,
  ): void {
    const mesh = this.own(new THREE.InstancedMesh(geometry, material, placements.length));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows && receiveShadow;
    this.object.add(mesh);
    this.batches.push({ mesh, placements });
  }

  private place(mesh: THREE.InstancedMesh, placements: Placement[], distance: number | null): void {
    const transform = this.transform;
    for (const [index, placement] of placements.entries()) {
      const z = distance === null ? placement.z
        : RECYCLE_AT - THREE.MathUtils.euclideanModulo(placement.z - distance + RECYCLE_AT, VIEW_LENGTH);
      transform.position.set(placement.x, -0.043, z);
      transform.rotation.set(0, placement.yaw, 0);
      transform.scale.set(placement.width, placement.height, placement.length);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
