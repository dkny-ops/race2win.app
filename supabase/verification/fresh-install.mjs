import fs from 'node:fs';import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const psql=process.env.PSQL_BIN||'psql';const host=process.env.PGHOST||'127.0.0.1';const port=process.env.PGPORT||'55439';
if(host!=='127.0.0.1'||port!=='55439')throw Error('Only the isolated local PostgreSQL on 127.0.0.1:55439 is allowed');
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(process.argv[2]||'verification-output');fs.mkdirSync(out,{recursive:true});
const database='rtw_migration_fresh_'+Date.now();const base=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',host,'-p',port,'-U','postgres'];
const env={...process.env};delete env.PGSERVICE;delete env.PGSERVICEFILE;
function run(db,args){return execFileSync(psql,[...base,'-d',db,...args],{encoding:'utf8',windowsHide:true,env,maxBuffer:8e6});}
run('postgres',['-c','create database '+database]);const files=fs.readdirSync(root+'/migrations').filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
try{run(database,['-f',root+'/verification/local-auth-bootstrap.sql']);for(const f of files)run(database,['-1','-f',root+'/migrations/'+f]);fs.writeFileSync(out+'/fresh-catalog.json',run(database,['-f',root+'/verification/catalog.sql']));fs.writeFileSync(out+'/fresh-behavior.log',run(database,['-f',root+'/verification/migration-behavior.sql']));fs.writeFileSync(out+'/fresh-result.json',JSON.stringify({status:'PASS',database,files,postgres:run(database,['-c','select version()']).trim()},null,2));console.log('PASS fresh installation: '+files.length+' migrations and behavior checks');}finally{run('postgres',['-c','drop database '+database]);}

