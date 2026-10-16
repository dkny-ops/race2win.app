import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual component's effect setup/cleanup with a provider double.
// No browser CAPTCHA, Auth call or email is performed by these regressions.
async function componentHarness(api) {
  const source = await readFile(new URL('../app/sign-in/turnstile-widget.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  let effects;
  const react = {
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect: setup => effects.push({ setup, cleanup: null }),
  };
  const jsx = (_type, props) => {
    if (props.ref) props.ref.current = {};
    return { props };
  };
  const compiledModule = { exports: {} };
  new Function('exports', 'module', 'require', 'window', output)(compiledModule.exports, compiledModule, name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'next/script') return { default: () => null };
    throw new Error(`Unexpected module ${name}`);
  }, { turnstile: api });
  return props => {
    effects = [];
    compiledModule.exports.TurnstileWidget(props);
    const owned = effects;
    const setup = () => owned.forEach(effect => { effect.cleanup = effect.setup(); });
    const cleanup = () => owned.forEach(effect => { effect.cleanup?.(); });
    setup();
    return { setup, cleanup };
  };
}

test('two widgets remount on cached-script navigation with fresh tokens and ignore old callbacks', async () => {
  const instances = [], removed = [], resets = [];
  const mount = await componentHarness({
    render: (_container, options) => { const id = `widget-${instances.length}`; instances.push({ id, options }); return id; },
    remove: id => removed.push(id), reset: id => resets.push(id),
  });
  const tokens = [null, null];
  const props = index => ({ siteKey: 'public-test-key', scriptReady: true, resetNonce: 0, onTokenChange: token => { tokens[index] = token; } });
  const first = [mount(props(0)), mount(props(1))];
  assert.equal(instances.length, 2);
  instances[0].options.callback('first-app'); instances[1].options.callback('first-native');
  assert.deepEqual(tokens, ['first-app', 'first-native']);
  first.forEach(widget => widget.cleanup());
  assert.deepEqual(tokens, [null, null]);
  const second = [mount(props(0)), mount(props(1))];
  assert.equal(instances.length, 4);
  instances[0].options.callback('stale-app'); instances[1].options.callback('stale-native');
  instances[0].options['expired-callback']();
  assert.deepEqual(tokens, [null, null]);
  assert.deepEqual(resets, []);
  instances[2].options.callback('new-app'); instances[3].options.callback('new-native');
  assert.deepEqual(tokens, ['new-app', 'new-native']);
  // React Strict Mode replays effects on mounted components.
  second.forEach(widget => widget.cleanup()); second.forEach(widget => widget.setup());
  assert.equal(instances.length, 6);
  assert.deepEqual(tokens, [null, null]);
  instances[2].options.callback('stale-after-replay');
  assert.deepEqual(tokens, [null, null]);
  instances[4].options.callback('fresh-app'); instances[5].options.callback('fresh-native');
  assert.deepEqual(tokens, ['fresh-app', 'fresh-native']);
  second.forEach(widget => widget.cleanup());
  assert.equal(removed.length, 6);
});

test('the form shares one script-ready signal between both independently reset widgets', async () => {
  const source = await readFile(new URL('../app/sign-in/sign-in-form.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<TurnstileScript\b/g) ?? []).length, 1);
  assert.equal((source.match(/<TurnstileWidget scriptReady=\{scriptReady\}/g) ?? []).length, 2);
  assert.match(source, /setTurnstileToken\(null\)/);
  assert.match(source, /setSupabaseCaptchaToken\(null\)/);
});
