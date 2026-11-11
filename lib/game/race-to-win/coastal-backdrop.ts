import * as THREE from "three";
import { CoastalMotion, type CoastalMotionFrame } from "./coastal-motion";

/** Source artwork registration, measured in the unchanged 1672×941 PNG. */
export const COASTAL_REGISTRATION = Object.freeze({
  horizon: 0.365,
  center: 0.495,
  roadHalfWidth: 9,
  sourceRoadSlope: 9 * 0.145,
});

/**
 * Image-backed scenery behind the existing 3D road and cars. Register the
 * painted road edges to the live road's projection rather than covering the
 * original beach with flat terrain or duplicating its buildings and palms.
 * This is a 2.5D composition: no image synthesis and no gameplay/camera writes.
 */
export class CoastalBackdrop {
  private readonly motion = new CoastalMotion();
  private readonly reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      artwork: { value: null },
      eye: { value: new THREE.Vector3() },
      horizon: { value: 0.35 },
      vanishingX: { value: 0.5 },
      skyWidth: { value: 1 },
      sideScale: { value: 0.54 },
      lateralScale: { value: 0.08 },
      sourceHorizon: { value: COASTAL_REGISTRATION.horizon },
      sourceCenter: { value: COASTAL_REGISTRATION.center },
      cloudPhase: { value: 0 },
      motionAmount: { value: 0 },
    },
    vertexShader: `
      varying vec2 screenUv;
      void main() {
        screenUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D artwork;
      uniform vec3 eye;
      uniform float horizon, vanishingX, skyWidth, sourceHorizon, sourceCenter;
      uniform float sideScale, lateralScale;
      uniform float cloudPhase, motionAmount;
      varying vec2 screenUv;

      float ellipse(vec2 point, vec2 center, vec2 radius) {
        float d = length((point - center) / radius);
        return 1.0 - smoothstep(0.7, 1.0, d);
      }

      vec4 sampleArtwork(vec2 p) {
        return texture2D(artwork, vec2(clamp(p.x, 0.0, 1.0), 1.0 - clamp(p.y, 0.0, 1.0)));
      }

      void main() {
        float row = 1.0 - screenUv.y;
        float groundRow = max(0.0, row - horizon);
        // Affine registration below the horizon keeps straight photo features
        // straight. No per-side nonlinear stretching of buildings or trunks.
        float sourceX = sourceCenter + (screenUv.x - vanishingX) * skyWidth
          + eye.x * groundRow * lateralScale;
        float sourceY = row <= horizon
          ? row / max(horizon, 0.001) * sourceHorizon
          : sourceHorizon + groundRow * sideScale;
        vec2 sampleUv = vec2(sourceX, sourceY);
        // The original photograph contains a second painted road, palms and
        // umbrellas below the horizon. Never project those flat objects onto
        // the moving 3D road: use the real sand/sea meshes for the ground.
        // Keep the original sky only, with a narrow horizon transition.
        vec4 original = sampleArtwork(sampleUv);
        if (row > horizon) {
          vec3 sand = vec3(0.823, 0.630, 0.417);
          vec3 sea = vec3(0.0, 0.50, 0.69);
          float shoreline = smoothstep(0.58, 0.65, sourceX);
          vec3 ground = mix(sand, sea, shoreline);
          float fade = smoothstep(0.0, 0.022, row - horizon);
          gl_FragColor = vec4(mix(original.rgb, ground, fade), 1.0);
          #include <colorspace_fragment>
          return;
        }
        if (motionAmount < 0.001) {
          gl_FragColor = original;
        } else {
        vec3 rgb = original.rgb;
        float edgeFade = smoothstep(0.0, 0.008, sampleUv.x) * (1.0 - smoothstep(0.992, 1.0, sampleUv.x));
        // Masks are measured on the existing photograph. No new clouds/leaves.
        float skyBand = smoothstep(0.11, 0.15, sampleUv.y) * (1.0 - smoothstep(0.29, 0.33, sampleUv.y));
        float notGreen = 1.0 - smoothstep(0.0, 0.09, rgb.g - rgb.b);
        float notWarm = 1.0 - smoothstep(0.0, 0.12, rgb.r - rgb.b);
        float sunProtection = 1.0 - ellipse(sampleUv, vec2(0.646, 0.064), vec2(0.11, 0.15));
        float sky = skyBand * notGreen * notWarm * sunProtection;
        vec2 displacement = vec2(sin(cloudPhase) * 0.0045 * sky, 0.0);
        vec4 animated = sampleArtwork(sampleUv + displacement * edgeFade * motionAmount);
        gl_FragColor = animated;
        }
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  public readonly object = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private readonly horizonPoint = new THREE.Vector3();

  public constructor() {
    this.object.name = "race123-original-coastal-backdrop";
    this.object.frustumCulled = false;
    this.object.renderOrder = -10000;
    this.object.visible = false;
  }

  public setTexture(texture: THREE.Texture): void {
    this.material.uniforms.artwork.value = texture;
    this.object.visible = true;
  }

  public update(camera: THREE.PerspectiveCamera, frame?: CoastalMotionFrame): void {
    camera.updateMatrixWorld();
    this.material.uniforms.eye.value.copy(camera.position);
    this.horizonPoint.set(camera.position.x, camera.position.y, camera.position.z - 10000).project(camera);
    this.material.uniforms.horizon.value = THREE.MathUtils.clamp((1 - this.horizonPoint.y) / 2, 0.05, 0.9);
    this.material.uniforms.vanishingX.value = (this.horizonPoint.x + 1) / 2;
    const skyWidth = Math.min(1, camera.aspect / (1672 / 941));
    this.material.uniforms.skyWidth.value = skyWidth;
    const lateralScale = skyWidth / (camera.position.y * camera.aspect);
    this.material.uniforms.lateralScale.value = lateralScale;
    this.material.uniforms.sideScale.value = lateralScale * COASTAL_REGISTRATION.roadHalfWidth / COASTAL_REGISTRATION.sourceRoadSlope;
    if (frame) {
      this.motion.advance(frame);
      const uniforms = this.material.uniforms;
      uniforms.cloudPhase.value = this.motion.cloudPhase;
      uniforms.motionAmount.value = this.reducedMotion ? 0 : 1;
    }
  }

  public dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    // Texture ownership stays with RaceToWinWorld.
  }
}
