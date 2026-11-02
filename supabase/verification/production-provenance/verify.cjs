// Native PostgreSQL verification without TCP sockets. Requires PostgreSQL 17 binaries.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const root=__dirname,supabase=path.resolve(root,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pgBin=process.env.POSTGRES_BIN;
if(!pgBin)throw Error('Set POSTGRES_BIN to the directory containing PostgreSQL 17 initdb and postgres binaries');
const output=path.resolve(process.argv[2]||'work/provenance-verification-'+Date.now());
const cluster=path.join(output,'cluster');fs.mkdirSync(output,{recursive:true});
if(fs.existsSync(cluster))throw Error('Use a new evidence directory; existing clusters are never overwritten');
const exe=n=>path.join(pgBin,n+(process.platform==='win32'?'.exe':''));
const init=cp.spawnSync(exe('initdb'),['-D',cluster,'-U','postgres','-A','trust','--encoding=UTF8','--locale=C'],{encoding:'utf8',windowsHide:true,maxBuffer:8e6});
fs.writeFileSync(path.join(output,'initdb.log'),(init.stdout||'')+(init.stderr||''));
if(init.error||init.status!==0)throw init.error||Error('initdb failed');
const passed=[];
function run(name,sql){
 const input=sql.replace(/^\s*$/gm,' ')+'\n\n';
 const r=cp.spawnSync(exe('postgres'),['--single','-j','-D',cluster,'postgres'],{input,encoding:'utf8',windowsHide:true,maxBuffer:16e6});
 fs.writeFileSync(path.join(output,name+'.log'),(r.stdout||'')+'\n'+(r.stderr||''));
 if(r.error||r.status!==0||/(?:ERROR|FATAL|PANIC):/.test(r.stderr||''))throw r.error||Error('Failed '+name+'; inspect its log');
 passed.push(name);
}
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const h of [...manifest.history,manifest.appliedMarker]){
 const file=path.join(supabase,'migrations',h.version+'_'+h.name+'.sql');
 if(h.sha256&&sha(fs.readFileSync(file))!==h.sha256)throw Error('SQL checksum mismatch: '+file);
}
run('bootstrap',read('auth-bootstrap.sql')+'\n'+read('auth-role.sql')+'\n'+read('cron-scaffold.sql')+'\n'+read('historical-identities.sql'));
for(const h of manifest.history){
 if(h.version==='20261026042207')run('owner-preflight-fixture',read('owner-fixture.sql'));
 if(h.version==='20261026202556')run('unrecorded-support-tables',read('support-tables.sql'));
 const file=h.version+'_'+h.name+'.sql';
 // The cron scaffold records job metadata. Background scheduling is not tested.
 const sql=fs.readFileSync(path.join(supabase,'migrations',file),'utf8').replace(/create extension if not exists pg_cron with schema pg_catalog\s*;/gi,'-- local pg_cron scaffold\n');
 run(file,'begin;\n'+sql+'\ncommit;');
}
run('runtime-provenance-overlay','begin;\n'+read('runtime-overlay.sql')+'\n'+read('table-grants-overlay.sql')+'\ncommit;');
const m=manifest.appliedMarker;
const marker=fs.readFileSync(path.join(supabase,'migrations',m.version+'_'+m.name+'.sql'),'utf8');
let noOp=read('no-op.sql').replaceAll('-- @RECONCILIATION_SQL@',marker);
run('marker-twice-no-row-changes',noOp);
run('financial-behavior',read('behavior.sql'));
run('catalog',read('catalog.sql'));
run('structural-fingerprints',read('structure-fingerprints.sql'));
fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'PASS',historicalMigrations:manifest.history.length,applicationTables:manifest.verification.applicationTables,applicationFunctions:manifest.verification.applicationFunctions,passed,limitations:manifest.verification.limitations},null,2));
console.log('PASS '+manifest.history.length+' recorded migrations, catalog equivalence, no-op repetition and financial fixtures');
console.log('Evidence: '+output);
