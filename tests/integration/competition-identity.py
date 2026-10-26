"""Disposable PostgreSQL 17 test. Never connects to a remote database.
PSQL_BIN=/path/to/psql python3 tests/integration/competition-identity.py
Requires the dedicated loopback cluster on 127.0.0.1:55439.
Auth is a scaffold, not GoTrue; cron records schedules without running jobs.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import os
import shutil
import subprocess
import time

root = Path(__file__).resolve().parents[2]
psql = os.environ.get("PSQL_BIN") or shutil.which("psql")
if not psql:
    raise RuntimeError("Set PSQL_BIN to a PostgreSQL 17 client")
flags = [psql, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55439", "-U", "postgres"]
env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
database = "competition_identity_" + str(time.time_ns())

def run(sql, target=database):
    result = subprocess.run(flags + ["-d", target], input=sql, text=True, capture_output=True, env=env)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

run("create database " + database, "postgres")
try:
    run((root / "supabase/verification/local-auth-bootstrap.sql").read_text())
    run("""alter table auth.users add column email text;
    create schema cron;
    create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid;
    $$;""")
    for migration in sorted((root / "supabase/migrations").glob("*.sql")):
        if "flappy_activate_reviewed" in migration.name:
            run("""insert into auth.users(id,email,email_confirmed_at)
              values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','racetowinapp@gmail.com',now());
              insert into private.admin_users(user_id,is_active)
              values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);""")
        run("begin;" + migration.read_text() + "commit;")
    print(run((root / "tests/integration/competition-identity.sql").read_text()))
    run("""insert into auth.users(id,email,email_confirmed_at)
      values('11111111-1111-4111-8111-111111111111','concurrent@test.invalid',now());""")
    def access(_):
        return run("""set role service_role;
          select public.rtw_record_competition_access('11111111-1111-4111-8111-111111111111','race-to-win',repeat('a',64));""")
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(access, range(30)))
    assert all(value == "allowed" for value in results), results
    assert run("select count(*) from private.competition_network_evidence") == "1"
    print("PASS: 30 concurrent service-role calls retain one evidence row")
finally:
    run("drop database " + database, "postgres")
