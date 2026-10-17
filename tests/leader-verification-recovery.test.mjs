import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/api/game-sessions/leader-verification/route.ts', import.meta.url), 'utf8');
function route({ user = 'owner', status = 'pending', decision = 'verified', required = true } = {}) {
  const calls = [];
  const compiled = { exports: {} };
  const admin = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name.startsWith('rtw_read_')) return { data: required ? [{ required: true, status, widget_required: true, expires_at: '2026-10-17T16:00:00Z' }] : [], error: null };
    if (name.startsWith('rtw_begin_')) return { data: [{ required: true, status: 'pending', widget_required: true }], error: null };
    return { data: 'verified', error: null };
  } };
  new Function('exports', 'module', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(compiled.exports, compiled, (name) => {
    if (name === 'next/server') return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
    if (name.endsWith('/official-inputs')) return { OFFICIAL_SESSION_UUID: /^[a-f0-9-]{36}$/, readOfficialSessionJson: r => r.json() };
    if (name.endsWith('/security-event')) return { createSecurityRequestId: () => 'request', logSecurityEvent() {} };
    if (name.endsWith('/turnstile')) return { getTurnstileWidgetConfiguration: () => ({ siteKey: 'public-key' }), verifyTurnstileToken: async (_token, action) => { assert.equal(action, 'weekly_leader_verification'); return { status: decision }; } };
    if (name.endsWith('/admin')) return { createAdminClient: () => admin, isAdminConfigured: () => true };
    if (name.endsWith('/server')) return { getVerifiedUserContext: async () => user ? { userId: user } : null };
    throw new Error(name);
  });
  return { ...compiled.exports, calls };
}
const sessionId = '11111111-1111-4111-8111-111111111111';
function request(body, origin = 'https://race2win.test') {
  return new Request('https://race2win.test/api/game-sessions/leader-verification', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }) });
}

test('cross-origin and unauthenticated requests cannot read or approve runs', async () => {
  for (const [options, origin] of [[{}, 'https://other.test'], [{ user: null }, 'https://race2win.test']]) {
    const api = route(options);
    assert.ok((await api.POST(request({ turnstileToken: 'token' }, origin))).status >= 400);
    assert.deepEqual(api.calls, []);
  }
});
test('rejected or unavailable provider never approves a run', async () => {
  for (const decision of ['rejected', 'unavailable']) {
    const api = route({ decision });
    assert.ok((await api.POST(request({ turnstileToken: 'token' }))).status >= 400);
    assert.deepEqual(api.calls.map(c => c.name), ['rtw_read_weekly_leader_human_verification']);
  }
});
test('server scopes approved verification to authenticated owner', async () => {
  const api = route();
  assert.equal((await api.POST(request({ turnstileToken: 'valid-token' }))).body.verified, true);
  assert.equal(api.calls.at(-1).name, 'rtw_verify_weekly_leader_human_verification');
  assert.deepEqual(api.calls.at(-1).args, { p_session_id: sessionId, p_player_id: 'owner' });
});
test('expired challenges can be restarted without approving a result', async () => {
  const api = route({ status: 'expired' });
  const response = await api.POST(request({ retry: true }));
  assert.equal(response.body.status, 'pending');
  assert.equal(api.calls.at(-1).name, 'rtw_begin_weekly_leader_human_verification');
  const get = await route({ status: 'expired' }).GET(new Request(`https://race2win.test/api/game-sessions/leader-verification?sessionId=${sessionId}`));
  assert.equal(get.body.required, true);
});
test('missing or already verified challenges cannot be approved again', async () => {
  for (const options of [{ required: false }, { status: 'verified' }]) {
    const api = route(options);
    assert.equal((await api.POST(request({ turnstileToken: 'token' }))).status, 409);
    assert.equal(api.calls.length, 1);
  }
});
