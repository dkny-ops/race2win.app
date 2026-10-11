import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  path = resolve(root, path);
  if (cache.has(path)) return cache.get(path).exports;
  const compiled = { exports: {} };
  cache.set(path, compiled);
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'module', 'require', output)(compiled.exports, compiled,
    name => name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name));
  return compiled.exports;
}
const { RaceToWinSimulation } = load('lib/game/race-to-win/simulation.ts');
const { replayAuthoritativeProgress, replayAuthoritativeRace } = load('lib/game/race-to-win/authoritative-replay.ts');
const { GAMEPLAY_VERSION, DEFAULT_RACE_TO_WIN_CONFIG: config } = load('lib/game/race-to-win/config.ts');

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const [key, entry] of Object.entries(value)) copy[key] = clone(entry);
  return copy;
}

test('v7 live input timestamps replay on the next tick across rounded boundaries', () => {
  for (let seed=1; seed<=10; seed++) {
    const simulation = new RaceToWinSimulation({ seed, trafficVariantCount: 6 });
    simulation.start();
    let snapshot=simulation.snapshot();
    for(let ticks=0; ticks<1200 && snapshot.state==='running'; ticks++) {
      if(ticks%15===0) simulation.requestLaneChange(Math.floor(ticks/15)%2===0 ? -1 : 1);
      snapshot=simulation.step(config.fixedStepMs);
      if(ticks%15===0 || snapshot.state==='crashed') {
        const replay=replayAuthoritativeProgress(GAMEPLAY_VERSION,seed,simulation.runRecord().inputs,snapshot.simulationTimeMs);
        assert.equal(replay.state,snapshot.state);
        assert.equal(replay.elapsedMs,snapshot.simulationTimeMs);
        assert.equal(replay.score,snapshot.metrics.score);
        assert.equal(replay.distanceMillimeters,Math.round(snapshot.metrics.distanceMeters*1000));
      }
    }
  }
});

test('unchanged official simulation supports a twelve-minute run and deterministic replay', () => {
  const simulation = new RaceToWinSimulation({ seed: 1, trafficVariantCount: 6 });
  simulation.start();
  let snapshot = simulation.snapshot();
  const checkpoints = [];
  let nextScore = 1000;
  let ticks = 0;
  while (snapshot.state === 'running' && snapshot.simulationTimeMs < 720000) {
    // A test-only predictive driver submits ordinary legal inputs. It never
    // changes the official configuration, traffic, elapsed time or score.
    if (ticks % 12 === 0) {
      let beam = [{ trial: clone(simulation), first: 0, moves: 0 }];
      for (let depth=0; depth<7; depth++) {
        const next = [];
        for (const node of beam) for (const direction of [0,-1,1]) {
          const trial = clone(node.trial);
          if (direction && !trial.requestLaneChange(direction)) continue;
          let future = trial.snapshot();
          for (let step=0; step<12 && future.state==='running'; step++) future=trial.step(config.fixedStepMs);
          if (future.state==='running') next.push({ trial, first: depth===0 ? direction : node.first, moves: node.moves + Number(direction!==0) });
        }
        if (!next.length) break;
        next.sort((a,b) => a.moves-b.moves);
        const seen = new Set();
        beam = next.filter(node => {
          const player=node.trial.snapshot().player;
          const key=`${node.first}:${player.targetLaneIndex}:${player.laneX.toFixed(2)}`;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        }).slice(0,12);
      }
      if (beam[0].first) simulation.requestLaneChange(beam[0].first);
    }
    snapshot = simulation.step(config.fixedStepMs);
    ticks++;
    if (snapshot.metrics.score >= nextScore) {
      checkpoints.push({ snapshot, inputs: simulation.runRecord().inputs });
      nextScore += 1000;
    }
  }
  assert.equal(snapshot.state, 'running', `driver crashed at ${snapshot.simulationTimeMs}ms`);
  assert.ok(snapshot.simulationTimeMs >= 720000);
  assert.ok(checkpoints.length > 3);
  for (const checkpoint of [checkpoints[0], checkpoints.at(-1)]) {
    const replay = replayAuthoritativeProgress(GAMEPLAY_VERSION, 1, checkpoint.inputs, checkpoint.snapshot.simulationTimeMs);
    assert.equal(replay.score, checkpoint.snapshot.metrics.score);
    assert.equal(replay.distanceMillimeters, Math.round(checkpoint.snapshot.metrics.distanceMeters * 1000));
  }
  const inputs = simulation.runRecord().inputs;
  const progress = replayAuthoritativeProgress(GAMEPLAY_VERSION, 1, inputs, snapshot.simulationTimeMs);
  assert.equal(progress.state, 'running');
  assert.equal(progress.score, snapshot.metrics.score);
  assert.equal(replayAuthoritativeRace(GAMEPLAY_VERSION, 1, inputs, snapshot.simulationTimeMs), null);
  // Finish with ordinary no-input driving; FINALIZE requires a real collision.
  while (snapshot.state === 'running') snapshot = simulation.step(config.fixedStepMs);
  const final = replayAuthoritativeRace(GAMEPLAY_VERSION, 1, simulation.runRecord().inputs, snapshot.simulationTimeMs);
  assert.equal(final.score, snapshot.metrics.score);
  assert.equal(final.collisionAtMs, snapshot.collision.atMs);
});
