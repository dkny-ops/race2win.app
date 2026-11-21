import * as THREE from "three";
import { ROAD_WIDTH, type RaceToWinQuality } from "./environment";
import { CoastalMotion, type CoastalMotionFrame } from "./coastal-motion";

const LOOP_LENGTH = 768;
const RECYCLE_BEHIND = 48;
const HORIZON_REACH = 740;

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
    const turf = new THREE.Color("#607b35");
    const grass = new THREE.Color("#839a49");
    const drySand = new THREE.Color("#e9cb91");
    const wetSand = new THREE.Color("#b8a374");
    const shallow = new THREE.Color("#27bcb5");
    const offshore = new THREE.Color("#167faf");

    surface.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {
        coastalDistance: this.distance, coastalPhase: this.phase,
        turf: { value: turf }, grass: { value: grass }, drySand: { value: drySand },
        wetSand: { value: wetSand }, shallow: { value: shallow }, offshore: { value: offshore },
      });
      shader.vertexShader = "varying vec2 coastPosition;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\ncoastPosition = position.xz;",
      );
      shader.fragmentShader = [
        "uniform float coastalDistance, coastalPhase;",
        "uniform vec3 turf, grass, drySand, wetSand, shallow, offshore;",
        "varying vec2 coastPosition;",
        shader.fragmentShader.replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float x = coastPosition.x;",
          "float z = coastPosition.y - coastalDistance;",
          "float grain = sin(x * 8.3 + z * 6.5) * sin(z * 7.2 - x * 3.1);",
          "grain *= 1.0 - smoothstep(0.18, 0.85, fwidth(x) + fwidth(z));",
          "float patches = 0.5 + 0.5 * sin(x * 0.26 + z * 0.18) * cos(z * 0.37 - x * 0.53);",
          "vec3 sand = drySand * (0.94 + patches * 0.1 + grain * 0.045);",
          "vec3 ground = mix(sand, mix(turf, grass, patches), smoothstep(10.0, 14.0, -x + patches * 2.0));",
          "float shore = x - 28.0 - 2.6 * sin(z * 0.029) - 0.85 * cos(z * 0.108);",
          "float tide = shore - 0.65 * sin(coastalPhase + z * 0.11);",
          "float swell = sin(shore * 0.89 + coastalPhase + sin(z * 0.13));",
          "float ripple = sin(shore * 2.1 + z * 0.63 + coastalPhase) * cos(z * 0.39 - shore * 1.2 - coastalPhase);",
          "vec3 water = mix(shallow, offshore, smoothstep(0.0, 65.0, shore));",
          "water *= 1.0 + 0.062 * swell + 0.045 * ripple;",
          "float lace = 0.57 + 0.22 * sin(z * 0.91 + shore * 3.0) + 0.21 * cos(z * 1.7 - coastalPhase);",
          "float foam = (1.0 - smoothstep(0.14, 0.78, abs(tide))) * lace;",
          "foam += smoothstep(0.93, 1.0, swell) * exp(-abs(shore - 5.0) * 0.32) * 0.24;",
          "vec3 beach = mix(ground, wetSand, smoothstep(-3.0, -0.4, tide) * 0.45);",
          "diffuseColor.rgb *= mix(mix(beach, water, smoothstep(-0.3, 0.6, tide)), vec3(0.86, 0.95, 0.93), foam);",
        ].join("\n")),
      ].join("\n");
    };
    const terrain = new THREE.Mesh(floor, surface);
    terrain.receiveShadow = quality.shadows;
    this.object.add(terrain);

    this.addHills(quality.mobile);

    const count = quality.mobile ? 22 : 32;
    const fronds = 8;
    this.palms = Array.from({ length: count }, (_, index) => ({
      x: -ROAD_WIDTH / 2 - 4.2 - (index * 7.17) % 23,
      z: (index + 0.4 * Math.sin(index * 8.91)) * LOOP_LENGTH / count,
      scale: 0.63 + (index * 0.173) % 0.72,
      angle: index * 2.39996,
    }));
    const trunk = new THREE.CylinderGeometry(0.13, 0.29, 7, 7, 3);
    const trunkPositions = trunk.getAttribute("position");
    for (let index = 0; index < trunkPositions.count; index++) {
      const height = (trunkPositions.getY(index) + 3.5) / 7;
      trunkPositions.setX(index, trunkPositions.getX(index) + height * height * 1.18);
    }
    trunk.translate(0, 3.5, 0);
    trunk.computeVertexNormals();

    const leaf = new THREE.PlaneGeometry(1, 1, 2, 8);
    const positions = leaf.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const t = 0.5 - positions.getY(index);
      const across = positions.getX(index);
      positions.setXYZ(index, t * 4.3, Math.sin(t * Math.PI) * 1.02 - t * t * 1.35 - Math.abs(across) * 0.22, across * 1.75 * Math.pow(Math.sin(t * Math.PI), 0.8));
    }
    leaf.computeVertexNormals();
    this.trunks = this.instances(trunk, new THREE.MeshStandardMaterial({ color: "#795535", roughness: 1 }), count);
    this.leaves = this.instances(leaf, new THREE.MeshStandardMaterial({ color: "#658836", side: THREE.DoubleSide, roughness: 0.84 }), count * fronds);
    for (let index = 0; index < count * fronds; index++) {
      const tint = new THREE.Color().setRGB(0.61 + (index * 0.319) % 0.36, 0.72 + (index * 0.27) % 0.26, 0.57 + (index * 0.11) % 0.39);
      this.leaves.setColorAt(index, tint);
    }

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
    this.update({ deltaSeconds: 0, distanceMeters: 0, speedKph: 0, running: false });
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

  private addHills(mobile: boolean): void {
    const terrain = this.own(new THREE.PlaneGeometry(185, 730, mobile ? 18 : 30, mobile ? 44 : 72));
    terrain.rotateX(-Math.PI / 2);
    terrain.translate(-133, -0.06, -300);
    const positions = terrain.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const blend = THREE.MathUtils.smoothstep(-x, 41, 99);
      const peaks = 14 + 12 * Math.sin(z * 0.021 + x * 0.046) + 9 * Math.cos(z * 0.038 - x * 0.019);
      positions.setY(index, -0.06 + blend * (peaks + 10));
    }
    terrain.computeVertexNormals();
    const material = this.own(new THREE.MeshStandardMaterial({ color: "#557c48", roughness: 1 }));
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
      for (let frond = 0; frond < 8; frond++) {
        const breeze = this.reducedMotion ? 0 : 0.04 * Math.sin(this.motion.windPhase + index * 0.8 + frond);
        transform.rotation.set(0, palm.angle + frond * Math.PI / 4, (frond % 3 - 1) * 0.14 + breeze);
        transform.updateMatrix();
        this.leaves.setMatrixAt(index * 8 + frond, transform.matrix);
      }
      transform.position.set(palm.x - 2.3 * palm.scale, -0.025, z + 2.9 * palm.scale);
      transform.rotation.set(0, 0.91, 0);
      transform.scale.set(palm.scale * 1.2, 1, palm.scale);
      transform.updateMatrix();
      this.shadows.setMatrixAt(index, transform.matrix);
    }
    for (const mesh of [this.trunks, this.leaves, this.shadows]) mesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    for (const resource of this.resources) resource.dispose();
  }
}
