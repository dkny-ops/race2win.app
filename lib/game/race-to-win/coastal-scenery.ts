import * as THREE from "three";
import { ROAD_WIDTH, type RaceToWinQuality } from "./environment";
import { CoastalMotion, type CoastalMotionFrame } from "./coastal-motion";

const LOOP_LENGTH = 768;
const RECYCLE_BEHIND = 48;
const HORIZON_REACH = 740;
const FRONDS = 12;
const SHRUB_CLUMPS = 5;

interface Palm {
  x: number;
  z: number;
  scale: number;
  angle: number;
}

export class CoastalScenery {
  public readonly object = new THREE.Group();
  private readonly resources = new Set<{ dispose(): void }>();
  private readonly distance = { value: 0 };
  private readonly phase = { value: 0 };
  private readonly motion = new CoastalMotion();
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly palms: Palm[];
  private readonly stones: THREE.InstancedMesh;
  private readonly shrubs: THREE.InstancedMesh;
  private readonly trunks: THREE.InstancedMesh;
  private readonly leaves: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly transform = new THREE.Object3D();

  public constructor(quality: RaceToWinQuality) {
    this.object.name = "race-to-win-coastal-world";
    const floor = this.own(new THREE.PlaneGeometry(1100, HORIZON_REACH + 80));
    floor.rotateX(-Math.PI / 2);
    floor.translate(340, -0.035, (80 - HORIZON_REACH) / 2);
    const surface = this.own(new THREE.MeshStandardMaterial({ roughness: 0.92 }));
    const meadow = this.texture("coastal-meadow", quality.mobile);
    const sandDetail = this.texture("coastal-sand", quality.mobile);
    const waterDetail = this.texture("coastal-water", quality.mobile);
    const foamDetail = this.texture("coastal-foam", quality.mobile);
    const forest = this.texture("coastal-forest", quality.mobile);
    const bark = this.texture("coastal-bark", quality.mobile);
    bark.repeat.set(1, 3);
    const turf = new THREE.Color("#4d632e");
    const grass = new THREE.Color("#7b8a45");
    const drySand = new THREE.Color("#e9cb91");
    const wetSand = new THREE.Color("#b8a374");
    const shallow = new THREE.Color("#179f9e");
    const offshore = new THREE.Color("#066693");

    surface.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {
        coastalDistance: this.distance, coastalPhase: this.phase, meadow: { value: meadow }, sandDetail: { value: sandDetail },
        waterDetail: { value: waterDetail }, foamDetail: { value: foamDetail },
        turf: { value: turf }, grass: { value: grass }, drySand: { value: drySand },
        wetSand: { value: wetSand }, shallow: { value: shallow }, offshore: { value: offshore },
      });
      shader.vertexShader = "varying vec2 coastPosition;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\ncoastPosition = position.xz;",
      );
      shader.fragmentShader = [
        "uniform float coastalDistance, coastalPhase;",
        "uniform sampler2D meadow, sandDetail, waterDetail, foamDetail;",
        "uniform vec3 turf, grass, drySand, wetSand, shallow, offshore;",
        "varying vec2 coastPosition;",
        shader.fragmentShader.replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float x = coastPosition.x;",
          "float z = coastPosition.y - coastalDistance;",
          "vec2 p = vec2(x,z);",
          "vec3 grassTexture = texture2D(meadow, p / 7.2).rgb;",
          "vec3 sandTexture = texture2D(sandDetail, p / 4.6).rgb;",
          "float patches = texture2D(meadow, p / 23.0).g;",
          "vec3 sand = mix(drySand, sandTexture, 0.84);",
          "vec3 ground = mix(sand, mix(mix(turf, grass, patches), grassTexture, 0.82), smoothstep(9.7, 13.6, -x + patches * 2.2));",
          "float shore = x - 24.0 - 2.9 * sin(z * 0.031) - 1.15 * cos(z * 0.094);",
          "float form = sin(z * 0.24) * 0.53 + cos(z * 0.41) * 0.27;",
          "float tide = shore + 0.82 * sin(coastalPhase + z * 0.12 + form);",
          "float wave = shore * 1.15 + coastalPhase + form + sin(z * 0.07) * 1.7;",
          "float wash = smoothstep(-0.31, 0.63, tide);",
          "vec3 beach = mix(ground, mix(wetSand, sandTexture * 0.57, 0.70), smoothstep(-5.5, 0.18, tide) * smoothstep(15.0, 19.0, x));",
          "float depth = smoothstep(1.0, 52.0, shore + form * 5.0);",
          "vec3 water = mix(shallow, offshore, depth);",
          "vec2 drift = vec2(sin(coastalPhase), cos(coastalPhase));",
          "vec2 detailUV = vec2(shore, z) * vec2(0.092, 0.073);",
          "vec2 refraction = 0.046 * vec2(sin(wave * 0.81 + z * 0.29), cos(shore * 1.3 + 2.0 * coastalPhase + z * 0.42));",
          "vec3 capillary = texture2D(waterDetail, detailUV + refraction + 0.08 * drift).rgb;",
          "vec3 swellDetail = texture2D(waterDetail, detailUV.yx * 0.51 - 0.05 * drift).rgb;",
          "float textureFade = 1.0 - smoothstep(0.64, 4.5, fwidth(z));",
          "water = mix(water, (capillary * 0.72 + swellDetail * 0.28) * vec3(0.90, 1.24, 1.56), textureFade * mix(0.86, 0.43, depth));",
          "vec3 eye = normalize(cameraPosition - vec3(x, 0.0, coastPosition.y));",
          "float fresnel = pow(1.0 - max(eye.y, 0.0), 5.0);",
          "water = mix(water, vec3(0.078, 0.29, 0.46), fresnel * depth * 0.31);",
          "float lace = texture2D(foamDetail, vec2(shore * 0.28, z * 0.18) + refraction + 0.038 * drift).r;",
          "float breaks = texture2D(foamDetail, vec2(z * 0.065, shore * 0.12) - 0.024 * drift).r;",
          "float fray = (lace - 0.24) * 1.45 + form * 0.53;",
          "float swash = 1.0 - smoothstep(0.09, 0.93, abs(tide + fray));",
          "float crest = smoothstep(0.72, 0.99, sin(wave + fray + breaks * 2.2));",
          "float offshoreFoam = crest * smoothstep(1.5, 4.5, tide) * (1.0 - smoothstep(9.0, 25.0, shore));",
          "float foam = max(swash * mix(0.42, 0.92, smoothstep(0.19, 0.58, lace)), offshoreFoam * textureFade * smoothstep(0.17, 0.62, lace + breaks * 0.42) * 0.65);",
          "diffuseColor.rgb *= mix(mix(beach, water, wash), vec3(0.86, 0.93, 0.91), foam);",
        ].join("\n")),
      ].join("\n");
    };
    const terrain = new THREE.Mesh(floor, surface);
    terrain.receiveShadow = quality.shadows;
    this.object.add(terrain);

    this.addHills(quality.mobile, forest);

    const count = quality.mobile ? 22 : 32;
    this.palms = Array.from({ length: count }, (_, index) => ({
      x: -ROAD_WIDTH / 2 - 4.8 - (index * 7.17) % 30,
      z: (index + 0.4 * Math.sin(index * 8.91)) * LOOP_LENGTH / count,
      scale: 0.79 + (index * 0.173) % 0.83,
      angle: index * 2.39996,
    }));
    const trunk = new THREE.CylinderGeometry(0.13, 0.29, 7, quality.mobile ? 8 : 12, 8);
    const trunkPositions = trunk.getAttribute("position");
    for (let index = 0; index < trunkPositions.count; index++) {
      const height = (trunkPositions.getY(index) + 3.5) / 7;
      trunkPositions.setX(index, trunkPositions.getX(index) + height * height * 1.18);
    }
    trunk.translate(0, 3.5, 0);
    trunk.computeVertexNormals();

    this.trunks = this.instances(trunk, new THREE.MeshStandardMaterial({ map: bark, color: "#a69373", roughness: 0.95 }), count);
    this.leaves = this.instances(this.frond(quality.mobile ? 15 : 21), new THREE.MeshStandardMaterial({ color: "#668d37", vertexColors: true, side: THREE.DoubleSide, roughness: 0.82 }), count * FRONDS);
    this.trunks.castShadow = quality.shadows;
    this.leaves.castShadow = quality.shadows;
    for (let index = 0; index < count * FRONDS; index++) {
      const tint = new THREE.Color().setRGB(0.58 + (index * 0.319) % 0.42, 0.69 + (index * 0.27) % 0.28, 0.48 + (index * 0.11) % 0.49);
      this.leaves.setColorAt(index, tint);
    }

    const shrubs = this.texture("coastal-shrubs", quality.mobile);
    const shrubCard = new THREE.PlaneGeometry(1, 1);
    shrubCard.translate(0, 0.48, 0);
    const shrubMaterial = new THREE.MeshStandardMaterial({ map: shrubs, alphaTest: 0.48, side: THREE.DoubleSide, roughness: 1, color: "#a9b58a" });
    this.shrubs = this.instances(shrubCard, shrubMaterial, count * SHRUB_CLUMPS * 2);
    const stone = new THREE.DodecahedronGeometry(1, 1);
    const stoneMap = this.texture("coastal-stone", quality.mobile);
    this.stones = this.instances(stone, new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 1, color: "#b8b6a1" }), count * SHRUB_CLUMPS);

    const shadow = new THREE.PlaneGeometry(8, 4);
    shadow.rotateX(-Math.PI / 2);
    const ink = new THREE.MeshBasicMaterial({ color: "#282c19", transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    ink.onBeforeCompile = shader => {
      shader.vertexShader = "varying vec2 shadowUV;\n" + shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\nshadowUV = uv;");
      shader.fragmentShader = "varying vec2 shadowUV;\n" + shader.fragmentShader.replace(
        "#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= 0.28 * (1.0 - smoothstep(0.12, 0.5, length(shadowUV - 0.5)));",
      );
    };
    this.shadows = this.instances(shadow, ink, count);
    this.shrubs.castShadow = quality.shadows;
    this.stones.castShadow = quality.shadows;
    this.update({ deltaSeconds: 0, distanceMeters: 0, speedKph: 0, running: false });
  }

  private texture(name: string, mobile: boolean): THREE.Texture {
    const texture = this.own(new THREE.TextureLoader().load("/images/" + name + ".webp"));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.anisotropy = mobile ? 2 : 8;
    return texture;
  }

  private frond(leaflets: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const arch = (t: number) => 1.43 * Math.sin(t * 2.8) - 1.48 * t * t;
    for (let index = 0; index < leaflets; index++) {
      const t = (index + 1) / (leaflets + 2);
      const x = t * 4.35;
      const y = arch(t);
      const length = Math.pow(Math.sin(t * Math.PI), 0.72) * 1.06;
      for (const side of [-1, 1]) {
        const base = [x - 0.09, y, 0];
        const mid = [x + 0.28, y + 0.035, side * length * 0.55];
        const edge = [x + 0.48, y - 0.09, side * length * 0.48];
        const tip = [x + 0.91, y - length * 0.49, side * length];
        positions.push(...base, ...mid, ...edge, ...mid, ...tip, ...edge);
        colors.push(0.72, 0.76, 0.47, 0.45, 0.58, 0.27, 0.28, 0.41, 0.19, 0.45, 0.58, 0.27, 0.81, 0.84, 0.45, 0.28, 0.41, 0.19);
      }
      const next = (index + 2) / (leaflets + 2);
      positions.push(x, y, -0.028, x, y, 0.028, next * 4.35, arch(next), 0);
      colors.push(0.77, 0.76, 0.39, 0.77, 0.76, 0.39, 0.77, 0.76, 0.39);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private own<T extends { dispose(): void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  private instances(geometry: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
    const mesh = this.own(new THREE.InstancedMesh(this.own(geometry), this.own(material), count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.object.add(mesh);
    return mesh;
  }

  private addHills(mobile: boolean, forest: THREE.Texture): void {
    const terrain = this.own(new THREE.PlaneGeometry(185, 730, mobile ? 18 : 30, mobile ? 44 : 72));
    terrain.rotateX(-Math.PI / 2);
    terrain.translate(-133, -0.06, -300);
    const uv = terrain.getAttribute("uv");
    const positions = terrain.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const blend = THREE.MathUtils.smoothstep(-x, 41, 99);
      const peaks = 14 + 12 * Math.sin(z * 0.021 + x * 0.046) + 9 * Math.cos(z * 0.038 - x * 0.019);
      const foothills = 3.8 * Math.sin(z * 0.077 + x * 0.093) + 2.2 * Math.sin(x * 0.2 - z * 0.12);
      positions.setY(index, -0.06 + blend * (peaks + foothills + 13));
      uv.setXY(index, (x - positions.getY(index) * 0.66) / 30, z / 30);
    }
    terrain.computeVertexNormals();
    const material = this.own(new THREE.MeshStandardMaterial({ map: forest, color: "#acbf94", roughness: 1 }));
    this.object.add(new THREE.Mesh(terrain, material));
  }

  public update(frame: CoastalMotionFrame): void {
    this.motion.advance(frame);
    this.distance.value = frame.distanceMeters;
    this.phase.value = this.reducedMotion ? 0 : this.motion.waterPhase;
    const transform = this.transform;
    for (const [index, palm] of this.palms.entries()) {
      // The rear wrap is behind the camera, and the forward wrap is beyond its far plane.
      const z = RECYCLE_BEHIND - THREE.MathUtils.euclideanModulo(palm.z - frame.distanceMeters + RECYCLE_BEHIND, LOOP_LENGTH);
      transform.position.set(palm.x, -0.035, z);
      transform.rotation.set(0, palm.angle, 0);
      transform.scale.setScalar(palm.scale);
      transform.updateMatrix();
      this.trunks.setMatrixAt(index, transform.matrix);
      transform.position.set(palm.x + 1.18 * palm.scale * Math.cos(palm.angle), 7 * palm.scale - 0.035, z - 1.18 * palm.scale * Math.sin(palm.angle));
      for (let frond = 0; frond < FRONDS; frond++) {
        const breeze = this.reducedMotion ? 0 : 0.04 * Math.sin(this.motion.windPhase + index * 0.8 + frond);
        transform.rotation.set(0, palm.angle + frond * 2.39996, (frond % 5 - 2) * 0.17 + breeze);
        transform.updateMatrix();
        this.leaves.setMatrixAt(index * FRONDS + frond, transform.matrix);
      }
      transform.position.set(palm.x - 2.3 * palm.scale, -0.025, z + 2.9 * palm.scale);
      transform.rotation.set(0, 0.91, 0);
      transform.scale.set(palm.scale * 1.2, 1, palm.scale);
      transform.updateMatrix();
      this.shadows.setMatrixAt(index, transform.matrix);
      for (let clump = 0; clump < SHRUB_CLUMPS; clump++) {
        const offset = (clump - 2) * 6.3 + Math.sin(index * 42.7 + clump * 0.83) * 4.2;
        const shrubZ = RECYCLE_BEHIND - THREE.MathUtils.euclideanModulo(palm.z + offset - frame.distanceMeters + RECYCLE_BEHIND, LOOP_LENGTH);
        const shrubX = -ROAD_WIDTH / 2 - 2.8 - (index * 12.09 + clump * 6.91) % 23.4;
        const size = 0.55 + (index * 0.73 + clump * 0.37) % 0.76;
        transform.position.set(shrubX, -0.035, shrubZ);
        transform.scale.set(7.7 * size, 2.65 * size, 1);
        for (let card = 0; card < 2; card++) {
          transform.rotation.set(0, palm.angle + card * Math.PI / 2, 0);
          transform.updateMatrix();
          this.shrubs.setMatrixAt((index * SHRUB_CLUMPS + clump) * 2 + card, transform.matrix);
        }
        const stoneScale = 0.21 + (index * 0.267 + clump * 0.39) % 0.67;
        transform.position.set(shrubX + 1.45 * size, stoneScale * 0.23 - 0.035, shrubZ - 1.5);
        transform.rotation.set(0.12, palm.angle + clump, 0.25);
        transform.scale.set(stoneScale * 1.36, stoneScale * 0.73, stoneScale);
        transform.updateMatrix();
        this.stones.setMatrixAt(index * SHRUB_CLUMPS + clump, transform.matrix);
      }
    }
    for (const mesh of [this.trunks, this.leaves, this.shadows, this.shrubs, this.stones]) mesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    for (const resource of this.resources) resource.dispose();
  }
}
