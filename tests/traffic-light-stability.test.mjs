import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/game/race-to-win/model-vehicles.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled)(require, compiledModule, compiledModule.exports);
const { createModelVehicleVisual, disposeModelVehicleVisual } = compiledModule.exports;
const template = () => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 5), new THREE.MeshStandardMaterial());
  mesh.name = "headlight";
  group.add(mesh);
  return group;
};
const lightCount = (root) => {
  let count = 0;
  root.traverse(object => { if (object.isLight) count++; });
  return count;
};

test("spawning and removing traffic does not change the scene light count", () => {
  const scene = new THREE.Scene();
  const player = createModelVehicleVisual(template(), true);
  scene.add(player.root);
  const fixedCount = lightCount(scene);
  assert.equal(fixedCount, 3, "player lighting stays available");
  for (let i = 0; i < 30; i++) {
    const traffic = createModelVehicleVisual(template(), false);
    scene.add(traffic.root);
    assert.equal(lightCount(scene), fixedCount, "traffic must not change shader light counts");
    const headlight = traffic.root.getObjectByName("headlight");
    assert.ok(headlight.material.emissiveIntensity > 0, "traffic headlights still glow");
    scene.remove(traffic.root);
    disposeModelVehicleVisual(traffic);
    assert.equal(lightCount(scene), fixedCount);
  }
  disposeModelVehicleVisual(player);
});
