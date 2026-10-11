// Exercises a pre-built local server without credentials or database writes.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3111';
const post=(path,body={},headers={})=>fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
for(const path of ['/api/game-sessions/start','/api/game-sessions/checkpoint','/api/game-sessions/finalize']) {
  const body=path.endsWith('/start') ? {} : {sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',inputs:[],...(path.endsWith('/checkpoint') ? {checkpointIndex:1} : {})};
  const responses=await Promise.all(Array.from({length:8},()=>post(path,body)));
  for(const response of responses) {
    assert.equal(response.status,401,path);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
  console.log(`PASS eight parallel unauthenticated HTTP requests denied: ${path}`);
}
const challenge=await post('/api/auth/request-code',{email:'synthetic@example.test'});
assert.equal(challenge.status,202);
assert.equal((await challenge.json()).nextStep,false);
assert.equal(challenge.headers.get('set-cookie'),null);
assert.equal((await post('/api/auth/verify-code',{token:'123456'})).status,400);
assert.equal((await fetch(`${base}/api/profile`)).status,401);
assert.equal((await fetch(`${base}/api/scores/me`)).status,401);
assert.equal((await fetch(`${base}/games/race-to-win`)).status,200);
console.log('PASS local HTTP: missing Auth configuration fails closed, no OTP challenge issued, guest game renders.');
