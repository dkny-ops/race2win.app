import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('../', import.meta.url));
test('hosted concurrency runner is opt-in and default mode creates no fixtures', () => {
  const output = execFileSync(process.execPath, ['scripts/test-concurrency-test.mjs'], {
    cwd, encoding: 'utf8', env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://lndvnufmbuzdbinapvze.supabase.co' },
  });
  assert.match(output, /Prepared only/);
});
test('hosted concurrency runner rejects Production before connecting', () => {
  let rejected = false;
  try {
    execFileSync(process.execPath, ['scripts/test-concurrency-test.mjs', '--execute'], {
      cwd, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://fspszgqmwhwfoiitnerp.supabase.co' },
    });
  } catch (error) {
    rejected = true;
    assert.match(error.stderr, /TEST only/);
  }
  assert.equal(rejected, true);
});

test('API executor refuses hosted writes until charge safety is confirmed', () => {
  let rejected = false;
  try {
    execFileSync(process.execPath, ['scripts/test-concurrency-api.mjs', '--execute'], {
      cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, RTW_TEST_FREE_QUOTA_CONFIRMED: '' },
    });
  } catch (error) {
    rejected = true;
    assert.match(error.stdout, /No requests sent/);
  }
  assert.equal(rejected, true);
});

test('API executor rejects a Production URL before making requests', () => {
  let rejected = false;
  try {
    execFileSync(process.execPath, ['scripts/test-concurrency-api.mjs', '--check'], {
      cwd, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://fspszgqmwhwfoiitnerp.supabase.co' },
    });
  } catch (error) {
    rejected = true;
    assert.match(error.stderr, /Existing TEST credentials required/);
  }
  assert.equal(rejected, true);
});
