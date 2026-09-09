import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/supabase/server.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load(authResult) {
  let calls = 0;
  const compiledModule = { exports: {} };
  const mockRequire = (name) => {
    if (name === "@supabase/ssr") return {
      createServerClient: () => ({ auth: { getUser: async () => { calls += 1; return authResult; } } }),
    };
    if (name === "next/headers") return { cookies: async () => ({ getAll: () => [], set: () => {} }) };
    throw new Error("Unexpected dependency: " + name);
  };
  new Function("exports", "module", "require", "process", compiled)(
    compiledModule.exports, compiledModule, mockRequire,
    { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test" } },
  );
  return { verify: compiledModule.exports.getVerifiedUserContext, calls: () => calls };
}

test("sensitive authorization accepts the user verified by live Auth", async () => {
  const auth = load({ data: { user: { id: "verified-owner" } }, error: null });
  assert.equal((await auth.verify()).userId, "verified-owner");
  assert.equal(auth.calls(), 1);
});

test("revoked or rejected Auth sessions never authorize a stale user", async () => {
  const auth = load({ data: { user: { id: "stale-owner" } }, error: { message: "Auth session missing!" } });
  assert.equal(await auth.verify(), null);
  assert.equal(auth.calls(), 1);
});

test("missing Auth users fail closed", async () => {
  assert.equal(await load({ data: { user: null }, error: null }).verify(), null);
});
