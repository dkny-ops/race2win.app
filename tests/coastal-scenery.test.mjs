import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

const source = readFileSync(new URL("../lib/game/race-to-win/city.ts", import.meta.url), "utf8");
const compiledModule = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => name === "three" ? THREE : { ROAD_SEGMENT_LENGTH: 96 }, compiledModule, compiledModule.exports);

for (const mobile of [false, true]) {
  test(`coastal scenery stays outside the road and recycles without a gap (${mobile ? "mobile" : "desktop"})`, () => {
    const city = new compiledModule.exports.RaceToWinCity({ mobile, shadows: !mobile, roadSegments: mobile ? 6 : 8 });
    city.object.updateMatrixWorld(true);
    city.object.traverse(item => {
      if (!item.isMesh) return;
      const bounds = new THREE.Box3().setFromObject(item);
      assert.ok(bounds.max.x < -9 || bounds.min.x > 9, "decorative geometry must not obstruct a driving lane");
    });
    city.update(0);
    const start = city.object.children.map(item => item.position.z);
    city.update(96);
    assert.deepEqual(city.object.children.map(item => item.position.z), start);
    city.update(95.99);
    const positions = city.object.children.map(item => item.position.z);
    for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i - 1] - positions[i] - 96) < 1e-9);
    const resources = new Set();
    city.object.traverse(item => {
      if (!item.isMesh) return;
      resources.add(item.geometry);
      for (const material of [item.material].flat()) resources.add(material);
    });
    let disposed = 0;
    for (const resource of resources) resource.addEventListener("dispose", () => disposed++);
    city.dispose();
    assert.equal(disposed, resources.size, "all owned geometry and materials are released exactly once");
  });
}
