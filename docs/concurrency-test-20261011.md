# Concurrencia real TEST — 2026-10-11

Estado: preparada, NO APROBADA. No se ejecutó auditoría ofensiva ni Codex Security.
Carpeta y rama oficiales preservadas; base `cc6aba2` con cambios locales.
No se crearon usuarios/sesiones de prueba alojados ni se realizaron escrituras
en TEST o Production durante esta fase de preparación.

## Evidencia obtenida realmente en TEST

- PostgreSQL 17.6, 24 migraciones aplicadas, FINALIZE con checkpoints y leases disponibles.
- RLS activado y sin privilegios SELECT/INSERT/UPDATE/DELETE para anon/authenticated
  en sesiones, resultados, Top7, semanal, ledger, balances y payouts.
- Índices únicos para sesión→resultado, checkpoint por sesión/índice y milestone,
  Top7 por rango y resultado, semanal por jugador/semana, crédito por ganador
  y reversión por crédito.
- FINALIZE bloquea la sesión con FOR UPDATE. El trigger adquiere el advisory
  lock de juego/semana antes de insertar el resultado; el recálculo semanal usa
  la misma clave. Esto se inspeccionó en el esquema actual, no solo en archivos.
- Dos consultas lanzadas en paralelo por el conector usaron backends distintos:
  931304, intervalo 21:59:52.458941–21:59:54.461642 UTC; 931306, intervalo
  21:59:57.898363–21:59:59.900432 UTC. No se solaparon. NO cuentan como carrera real.
- No hay conexión RTW_TEST_DATABASE_URL, cliente psql, driver pg ni postgres.
  No se instalaron extensiones, servidores, planes o recursos. Registro npm
  inaccesible desde esta sesión. El ejecutor se detuvo antes de crear fixtures.

## Ejecutor preparado

`scripts/test-concurrency-test.mjs`: opt-in `--execute`; tres conexiones pg
independientes con TLS validado, TEST exacto y rama/carpeta obligatorias.
No imprime DSN ni errores privados del proveedor. Verifica solapamiento mediante
pg_blocking_pids antes de soltar el lock; no considera Promise.all evidencia
suficiente de concurrencia. Rechaza el pooler transaccional 6543.

Casos preparados, todavía NO ejecutados:
- FINALIZE idénticos y contradictorios; un único resultado durable; retry SQL
  rechazado con 23514 (la idempotencia HTTP canónica es una comprobación aparte).
- Checkpoints idénticos, contradictorios y contra FINALIZE en ambos órdenes.
- Diez finalizaciones solapadas por pares en la misma semana: Top7 40..100=490,
  vector semanal de diez partidas completo, sin doble contabilización.
- Rechazo de propietario ajeno, RPC/table ACL de anon y authenticated.
- Confirmación de cero premios, ledger, balances o payouts para los fixtures.

Los fixtures usan dos UUID sintéticos y fecha futura aislada 2099-01-05 para
no entrar en la semana actual. Se exige que esa semana no tenga resultados
ni ganadores existentes. La fecha futura y resultados proporcionados a SQL
son fixtures privilegiados: NO representan replay aprobado ni partidas HTTP.
No se modifican reglas, triggers ni funciones. No se generan premios,
créditos, retiros ni correos. La limpieza limita cada DELETE a esos UUID y
rechaza borrar si aparece ledger inesperado. Si falla, imprime únicamente
IDs sintéticos para recuperación; no hacer borrados generales.

Pendientes fuera del ejecutor: concurrencia autenticada HTTP de extremo a
extremo; replay real; owner RLS con JWT emitido por Auth; créditos simultáneos,
generación de recompensas, balances y pagos. Los índices financieros no
demuestran por sí solos su comportamiento bajo carrera. Mantener aprobación
humana de premios y no ejecutar flujos de pago para completar una prueba.

## Primer requisito manual

### Actualización: evitar restablecer la contraseña

No se conoce la contraseña postgres y no se debe restablecer todavía. Las
credenciales públicas/administrativas TEST ya existen; no son la contraseña
PostgreSQL ni se pueden usar como tal. Como alternativa, PostgREST permite
invocar los RPC existentes con la clave administrativa sin contraseña SQL.
`scripts/check-test-api-access.mjs` comprueba solo GET de cero filas con dos
conexiones HTTPS independientes, descartando cuerpos y sin correos/escrituras.
En esta sesión el acceso de red quedó no verificado. Ejecutarlo en PowerShell
del usuario permite comprobar esa vía antes de cambiar credenciales:

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
node scripts/check-test-api-access.mjs
```

Un HTTP 200 confirma el acceso API. El solapamiento de transporte NO demuestra
locks SQL simultáneos. Si funciona, preparar un ejecutor RPC con fixtures
sintéticos y verificación de resultados; las transacciones sostenidas y
pg_blocking_pids siguen requiriendo acceso SQL independiente u otra medición
autorizada. No se añadió ninguna función alojada para prolongar locks.

Otro ensayo SQL de ocho segundos tampoco se solapó: backend 932847 entre
22:19:43.852831–22:19:51.854226 UTC; backend 932849 entre
22:19:52.789994–22:20:00.798070 UTC. El conector disponible no demuestra
concurrencia en estos ensayos. No asumir que el proyecto carece de capacidad
de conexiones simultáneas por ese comportamiento del conector.

Una alternativa adicional es un rol SQL temporal con permisos mínimos y su
propia contraseña, que evita rotar postgres. No se creó ni se concedieron
permisos: requiere diseño/revisión y autorización de ese cambio de acceso.
El ejecutor actual espera postgres; no es compatible automáticamente con un
rol mínimo y no se debe conceder postgres/service_role completo como atajo.

### Si finalmente se autoriza rotar postgres TEST

No es obligatorio para la alternativa API. La foto actual de pg_stat_activity
mostró PostgREST/authenticator, pgbouncer, pg_net, pg_cron, exporter y
supabase_admin; no mostró un cliente externo identificado. Esto no demuestra
ausencia de conexiones desconectadas, tareas nocturnas o DSN en otro servicio.

1. Inventariar sin imprimir secretos: variables TEST de Vercel Preview/
   Development y conexiones PostgreSQL directas en scripts/CLI, CI, Prisma,
   Drizzle, herramientas SQL, integraciones y tareas programadas. No inspeccionar
   ni editar Production como parte de esta rotación. Buscar credenciales
   existentes privadamente antes de cambiar nada.
2. La aplicación local usa URL/API keys. Rotar postgres no rota esas keys,
   secretos Turnstile, SMTP Resend ni contraseñas de usuarios Auth. Supabase
   documenta actualización automática de sus servicios gestionados; clientes
   externos que usan postgres con contraseña guardada requieren actualización.
3. Preparar ventana de mantenimiento TEST y respaldo/recuperación sin contratar
   recursos. Identificar responsables y cada DSN que se actualizará; detenerse
   ante cargos por respaldo o cambio de plan. No iniciar rotación sin aprobación.
4. El propietario genera/guarda la nueva contraseña en un gestor privado y,
   tras autorizarlo, cambia solo Database Settings del TEST exacto. No escribir
   contraseñas en SQL de revisión, terminal visible, Git, capturas o chat.
5. Actualizar exclusivamente clientes externos TEST identificados; codificar
   caracteres especiales en DSN. Validar reconexión SQL, API y Auth sin enviar
   OTP automáticamente. No reiniciar procesos ni desplegar para probar acceso
   hasta entender si esa acción tendría efectos adicionales.
6. Recuperación: si falla un cliente, mantener sus trabajos detenidos y reparar
   su DSN/certificado; la contraseña desconocida anterior no ofrece un rollback.
   No prometer restaurarla. Una segunda rotación también exige actualizar todos
   los clientes y autorización. Conservar los respaldos y cambios locales.

Fuente: https://supabase.com/docs/guides/database/postgres/roles

El siguiente apartado describe la opción SQL original, no una instrucción
para restablecer contraseñas.

En Supabase TEST `lndvnufmbuzdbinapvze` → Connect → Session pooler, copia la
cadena PostgreSQL con puerto 5432. Guárdala privadamente en `.env.local` como
`RTW_TEST_DATABASE_URL`; sin NEXT_PUBLIC, sin compartirla en chat. El usuario
debe ser `postgres.lndvnufmbuzdbinapvze`, el host el mostrado por TEST, la base
postgres. Sustituye el marcador de contraseña en privado. El ejecutor requiere
URL sin query parameters y fuerza TLS `rejectUnauthorized: true`; no usar
sslmode=require como sustituto de validación de certificado. Si no conoces la
contraseña, no la restablezcas sin revisar el impacto en otras conexiones.

El driver gratuito pg puede instalarse solo en node_modules del entorno oficial,
sin modificar package.json ni lockfile:

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
npm.cmd install --no-save --package-lock=false pg
node scripts/test-concurrency-test.mjs
```

Primero revisar sintaxis, credenciales, certificados y plan/cuota existentes.
La preparación no concede prueba de ausencia de cargos: si el panel advierte
costos o overage, detenerse. No requiere proyecto nuevo ni cambio de plan.
Después, una ejecución explícita `node scripts/test-concurrency-test.mjs --execute`
realiza únicamente los fixtures y operaciones TEST descritos. No arrancar
otro servidor ni migrar Production.

Validaciones locales: sintaxis y modo preparado del ejecutor; ESLint; pruebas
de seguridad del ejecutor opt-in/rechazo de Production. No equivalen a la
prueba alojada. Las pruebas WASM anteriores siguen siendo simulación de
transportes/Auth, no conexiones concurrentes de PostgreSQL alojado.

Referencias: https://node-postgres.com/features/connecting y
https://supabase.com/docs/guides/database/connecting-to-postgres
