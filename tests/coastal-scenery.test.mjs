import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

const source = readFileSync(new URL("../lib/game/race-to-win/coastal-backdrop.ts", import.meta.url), "utf8");
const compiledModule = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(() => THREE, compiledModule, compiledModule.exports);

for (const mobile of [false, true]) {
  test(`image scenery cannot occlude traffic, change the camera or dispose its borrowed image (${mobile ? "mobile" : "desktop"})`, () => {
    const backdrop = new compiledModule.exports.CoastalBackdrop();
    const camera = new THREE.PerspectiveCamera(mobile ? 66 : 60, mobile ? 390 / 844 : 1440 / 948, 0.1, 430);
    camera.position.set(-4.1, 7.22, 14.1);
    camera.lookAt(-2, 1.05, -21.5);
    const before = { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect };
    const texture = new THREE.Texture();
    let textureDisposed = false;
    texture.addEventListener("dispose", () => { textureDisposed = true; });
    assert.equal(backdrop.object.visible, false);
    backdrop.setTexture(texture);
    backdrop.update(camera);
    assert.deepEqual({ position: camera.position.toArray(), rotation: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect }, before);
    assert.equal(backdrop.object.visible, true);
    assert.equal(backdrop.object.material.depthWrite, false);
    assert.equal(backdrop.object.material.depthTest, false);
    assert.ok(backdrop.object.renderOrder < 0, "photo is drawn before road and vehicles");
    assert.equal(backdrop.object.material.uniforms.artwork.value, texture);
    const uniforms = backdrop.object.material.uniforms;
    assert.ok(uniforms.horizon.value > 0 && uniforms.horizon.value < 1);
    assert.ok(uniforms.sourceHorizon.value + (1 - uniforms.horizon.value) * uniforms.sideScale.value < 1, "sampling stays within the source image vertically");
    const resources = [backdrop.object.geometry, backdrop.object.material];
    let disposed = 0;
    for (const resource of resources) resource.addEventListener("dispose", () => disposed++);
    backdrop.dispose();
    assert.equal(disposed, resources.length, "all owned geometry and materials are released exactly once");
    assert.equal(textureDisposed, false, "world retains ownership of the unchanged photo");
    texture.dispose();
  });
}
