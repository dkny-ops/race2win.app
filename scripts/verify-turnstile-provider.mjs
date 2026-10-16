// Explicit opt-in network check. Only Cloudflare's PUBLIC dummy keys are used.
// Never loads .env, real credentials, accounts or a database connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../lib/security/turnstile.ts',import.meta.url),'utf8');
for(const [prefix,reason] of [['1','action_mismatch'],['2','provider_rejected'],['3','expired_or_reused']]) {
  const env={ TURNSTILE_ENFORCEMENT_ENABLED:'true', TURNSTILE_SECRET_KEY:`${prefix}x${'0'.repeat(31)}AA`,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:'public-dummy-site-key',TURNSTILE_ALLOWED_HOSTNAMES:'example.test',TURNSTILE_ENABLED_ACTIONS:'otp_request' };
  const compiledModule={exports:{}};
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','module','require','process',output)(compiledModule.exports,compiledModule,name=>{assert.equal(name,'server-only');return {};},{env});
  const outcome=await compiledModule.exports.verifyTurnstileToken('XXXX.DUMMY.TOKEN.XXXX','otp_request',{
    fetchImpl:async (...args)=>{
      try {
        const response=await fetch(...args);
        if(!response.ok) console.log(`Provider HTTP status: ${response.status}`);
        return response;
      } catch(error) {
        console.log(`Provider transport code: ${error.cause?.code ?? error.code ?? error.name}`);
        throw error;
      }
    },
  });
  if(outcome.status==='unavailable') {
    console.log('NOT VERIFIED: external provider unavailable; application failed closed.');
    process.exitCode=2;
    break;
  }
  assert.deepEqual(outcome,{status:'rejected',reason});
  console.log(`PASS live Cloudflare dummy-key response: ${reason}`);
}
console.log('No production widget/credentials tested; dummy action differs from otp_request and must remain rejected.');
