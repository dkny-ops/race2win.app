import * as THREE from "three";
import { ROAD_SEGMENT_LENGTH, type RaceToWinQuality } from "./environment";
import { CoastalMotion, type CoastalMotionFrame } from "./coastal-motion";

/** Scenic billboards occupy world space; only the existing snapshot moves them. */
export class CoastalScenery {
  public readonly object = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly instances: THREE.InstancedMesh[] = [];
  private readonly motion = new CoastalMotion();
  private readonly wind = { value: 0 };
  private readonly waterTime = { value: 0 };
  private readonly reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private disposed = false;

  public constructor(private readonly quality: RaceToWinQuality) {
    this.object.name = "race-to-win-moving-coastal-layers";
    this.object.visible = false;
    void this.load();
  }

  private async load(): Promise<void> {
    // Race123.PNG is the canonical, repository-owned coastal artwork.
    // Optional extracted sprite images must never prevent the terrain from
    // loading: otherwise the road floats over the scene's blue clear color.
    const loader = new THREE.TextureLoader();
    const load = async (path: string): Promise<THREE.Texture | null> => {
      try {
        const texture = await loader.loadAsync(path);
        texture.colorSpace = THREE.SRGBColorSpace;
        if (this.disposed) texture.dispose();
        else this.textures.push(texture);
        return this.disposed ? null : texture;
      } catch {
        return null;
      }
    };
    const source = await load("/images/Race123.PNG");
    if (!source || this.disposed) return;
    const [palm, vegetation] = await Promise.all([
      load("/images/coastal-palm.webp"),
      load("/images/coastal-vegetation.webp"),
    ]);
    if (this.disposed) return;
    // A transparent texture keeps the original 3D sand/sea geometry alive
    // without introducing opaque, rectangular photographs as fake palms.
    const blank = document.createElement("canvas");
    blank.width = blank.height = 2;
    const blankTexture = new THREE.CanvasTexture(blank);
    this.textures.push(blankTexture);
    this.build(palm ?? blankTexture, vegetation ?? blankTexture, source);
    this.object.visible = true;
  }

  private texturePatch(source: THREE.Texture, sx: number, sy: number, sw: number, sh: number, repeatX: number, repeatY: number): THREE.CanvasTexture {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
      context.save(); context.translate(column ? 256 : 0, row ? 256 : 0);
      context.scale(column ? -1 : 1, row ? -1 : 1);
      context.drawImage(source.image as HTMLImageElement, sx, sy, sw, sh, 0, 0, 128, 128);
      context.restore();
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = this.quality.mobile ? 2 : 4;
    this.textures.push(texture); return texture;
  }

  private spriteMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
    material.onBeforeCompile = shader => {
      shader.uniforms.coastalWind = this.wind;
      shader.vertexShader = `uniform float coastalWind;\n${shader.vertexShader}`.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        transformed.x += sin(coastalWind) * sin(coastalWind * 2.0 + uv.x * 3.14159) * smoothstep(0.45, 0.92, uv.y) * 0.004;
      `);
    };
    material.customProgramCacheKey = () => "coastal-palm-breeze-v1";
    this.materials.push(material); return material;
  }

  private build(palm: THREE.Texture, vegetation: THREE.Texture, source: THREE.Texture): void {
    const segments = this.quality.roadSegments;
    const plane = new THREE.PlaneGeometry(1, ROAD_SEGMENT_LENGTH); this.geometry.push(plane);
    // Use clean sand surfaces instead of the former repeated 28px photo strip.
    const water = this.texturePatch(source, 1290, 347, 230, 62, 1, 1);
    const sandMat = new THREE.MeshBasicMaterial({ color: "#ead0a2", toneMapped: false });
    const leftSandMat = new THREE.MeshBasicMaterial({ color: "#ead0a2", toneMapped: false });
    this.materials.push(sandMat, leftSandMat);
    const sea = new THREE.ShaderMaterial({
      uniforms: { time: this.waterTime, waterMap: { value: water }, deep: { value: new THREE.Color("#008ec4") } },
      vertexShader: `varying vec2 waterUv; void main(){waterUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float time; uniform sampler2D waterMap; uniform vec3 deep; varying vec2 waterUv;
        void main(){
          vec2 ripple=vec2(sin(waterUv.y*40.0+time),sin(waterUv.x*30.0+time))*0.003;
          vec3 color=texture2D(waterMap,waterUv.yx*vec2(8.0,12.0)+ripple+vec2(0.0,time/6.28318530718)).rgb;
          color=mix(color,deep,smoothstep(0.0,0.08,waterUv.x)*0.95);
          color*=1.0+sin(waterUv.x*130.0-time)*sin(waterUv.y*110.0+time)*0.008;
          gl_FragColor=vec4(color,1.0);
          #include <colorspace_fragment>
        }`,
      toneMapped: false,
    });
    this.materials.push(sea);
    const card = new THREE.PlaneGeometry(1, 1, 8, 12); card.translate(0, 0.5, 0); this.geometry.push(card);
    const palms = new THREE.InstancedMesh(card, this.spriteMaterial(palm), segments * 8);
    const bushes = new THREE.InstancedMesh(card, this.spriteMaterial(vegetation), segments * 10);
    palms.name = "coastal-palm-layer"; bushes.name = "coastal-low-vegetation-layer";
    const shadowGeometry = new THREE.PlaneGeometry(1, 1); shadowGeometry.rotateX(-Math.PI / 2); this.geometry.push(shadowGeometry);
    const shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 shadowUv;void main(){shadowUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 shadowUv;void main(){float a=(1.0-smoothstep(0.0,0.5,length(shadowUv-0.5)))*0.18;gl_FragColor=vec4(0.1,0.08,0.04,a);}`,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.materials.push(shadowMaterial);
    const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, segments * 8);
    const curbGeometry = new THREE.BoxGeometry(0.55, 0.7, 3.98); this.geometry.push(curbGeometry);
    const white = new THREE.MeshBasicMaterial({ color: "#f8f4e9", toneMapped: false });
    const red = new THREE.MeshBasicMaterial({ color: "#eb3636", toneMapped: false }); this.materials.push(white, red);
    const whiteCurbs = new THREE.InstancedMesh(curbGeometry, white, segments * 24);
    const redCurbs = new THREE.InstancedMesh(curbGeometry, red, segments * 24);
    const transform = new THREE.Object3D(); let palmIndex = 0, bushIndex = 0, whiteIndex = 0, redIndex = 0;
    const put = (mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, width: number, height: number) => {
      transform.position.set(x, y, z); transform.rotation.set(0, 0, 0); transform.scale.set(width, height, 1); transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    };
    for (let segment = 0; segment < segments; segment++) {
      const z = -(segment - 1) * ROAD_SEGMENT_LENGTH;
      for (const [x, width, material] of [[-59.05, 100, leftSandMat], [17.525, 16.95, sandMat], [126, 200, sea]] as const) {
        const ground = new THREE.Mesh(plane, material); ground.rotation.x = -Math.PI / 2;
        ground.position.set(x, -0.025, z); ground.scale.x = width; this.object.add(ground);
      }
      for (let n = 0; n < 4; n++) for (const side of [-1, 1]) {
        const height = 13 + n % 3 * 1.3;
        transform.position.set(side * (11.4 + n % 2 * 1.8) - height * 0.1, -0.019, z - 36 + n * 24);
        transform.scale.set(2.5, 1, 1.8); transform.updateMatrix(); shadows.setMatrixAt(palmIndex, transform.matrix);
        put(palms, palmIndex++, side * (11.4 + n % 2 * 1.8), -height * 0.012, z - 36 + n * 24, height * 2 / 3, height);
      }
      for (let n = 0; n < 6; n++) put(bushes, bushIndex++, -12.6, -0.12, z - 44 + n * 16, 4, 1.0);
      for (let n = 0; n < 4; n++) put(bushes, bushIndex++, -20, -0.15, z - 36 + n * 24, 5, 1.5);
      for (let n = 0; n < 24; n++) for (const side of [-1, 1]) {
        const mesh = n % 2 === 0 ? whiteCurbs : redCurbs;
        const index = n % 2 === 0 ? whiteIndex++ : redIndex++;
        put(mesh, index, side * 9.32, 0.3, z - 46 + n * 4, 1, 1);
      }
    }
    for (const mesh of [palms, bushes, whiteCurbs, redCurbs, shadows]) { mesh.computeBoundingSphere(); this.instances.push(mesh); this.object.add(mesh); }
  }

  public update(frame: CoastalMotionFrame): void {
    this.motion.advance(frame);
    this.wind.value = this.reducedMotion ? 0 : this.motion.windPhase;
    this.waterTime.value = this.reducedMotion ? 0 : this.motion.waterPhase;
    // Same world scroll as the road: distance-based, no independent travel clock.
    this.object.position.z = (Number.isFinite(frame.distanceMeters) ? Math.max(0, frame.distanceMeters) : 0) % ROAD_SEGMENT_LENGTH;
  }

  public dispose(): void {
    this.disposed = true;
    for (const mesh of this.instances) mesh.dispose();
    for (const item of this.geometry) item.dispose();
    for (const item of this.materials) item.dispose();
    for (const item of this.textures) item.dispose();
  }
}
