import * as THREE from "three";

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
      varying vec2 screenUv;

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
        gl_FragColor = texture2D(artwork, vec2(clamp(sampleUv.x, 0.0, 1.0), 1.0 - sampleUv.y));
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

  public update(camera: THREE.PerspectiveCamera): void {
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
  }

  public dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    // Texture ownership stays with RaceToWinWorld.
  }
}
