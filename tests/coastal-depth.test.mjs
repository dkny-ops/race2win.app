import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

function compile(name, imports) {
  const compiled = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(readFileSync(new URL(`../lib/game/race-to-win/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(key => imports[key], compiled, compiled.exports);
  return compiled.exports;
}
const motion = compile("coastal-motion", {});

for (const mobile of [false, true]) test(`world-space scenery has real depth, synchronized recycling and no road intrusion (${mobile ? "mobile" : "desktop"})`, async () => {
  const textures = [];
  class Loader {
    async loadAsync() { const texture = new THREE.Texture({ width: 1672, height: 941 }); textures.push(texture); return texture; }
  }
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ save() {}, translate() {}, scale() {}, drawImage() {}, restore() {} }) }) };
  let scenery;
  try {
    const { CoastalScenery } = compile("coastal-scenery", { "three": { ...THREE, TextureLoader: Loader }, "./environment": { ROAD_SEGMENT_LENGTH: 96 }, "./coastal-motion": motion });
    scenery = new CoastalScenery({ mobile, roadSegments: mobile ? 6 : 8 });
    await new Promise(setImmediate);
    assert.equal(scenery.object.visible, true);
    scenery.object.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4();
    scenery.object.traverse(item => {
      if (!item.isMesh) return;
      item.geometry.computeBoundingBox();
      for (let i = 0; i < (item.isInstancedMesh ? item.count : 1); i++) {
        if (item.isInstancedMesh) { item.getMatrixAt(i, matrix); matrix.premultiply(item.matrixWorld); } else matrix.copy(item.matrixWorld);
        const bounds = item.geometry.boundingBox.clone().applyMatrix4(matrix);
        assert.ok(bounds.max.x < -9 || bounds.min.x > 9, "decorative geometry must stay outside all driving lanes");
      }
    });
    const palms = scenery.object.getObjectByName("coastal-palm-layer");
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 430);
    camera.position.set(0, 7.22, 14.1); camera.lookAt(0, 1.05, -21.5); camera.updateMatrixWorld();
    const projected = index => {
      palms.getMatrixAt(index, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix).add(scenery.object.position).project(camera);
    };
    const nearBefore = projected(8), farBefore = projected(24);
    scenery.update({ deltaSeconds: 0.1, distanceMeters: 10, speedKph: 108, running: true });
    assert.equal(scenery.object.position.z, 10);
    assert.ok(Math.abs(projected(8).x - nearBefore.x) > Math.abs(projected(24).x - farBefore.x) * 3, "near palms move across the screen faster than distant ones");
    const children = scenery.object.children.length;
    for (let i = 0; i < 1000; i++) scenery.update({ deltaSeconds: 0.1, distanceMeters: i * 10, speedKph: 360, running: true });
    assert.equal(scenery.object.children.length, children);
    scenery.update({ deltaSeconds: 0.1, distanceMeters: 96, speedKph: 108, running: true });
    assert.equal(scenery.object.position.z, 0, "same 96m recycling boundary as the existing road");
    const resources = new Set([...scenery.geometry, ...scenery.materials, ...scenery.textures, ...scenery.instances]);
    let disposed = 0; for (const resource of resources) resource.addEventListener("dispose", () => disposed++);
    scenery.dispose(); scenery = null;
    assert.equal(disposed, resources.size);
  } finally { scenery?.dispose(); globalThis.document = oldDocument; }
});
