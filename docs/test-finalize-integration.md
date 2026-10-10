# Race To Win: integración preparada para revisión

Fecha: 10 octubre 2026. Entorno: Windows local del usuario. Carpeta original: C:\Users\crist\Documents\Codex\race2win.app. Carpeta aislada: C:\Users\crist\Documents\Codex\race2win-integration-20261010. Rama: integration/test-finalize-20261010.

## Estado Git y conservación

main local sigue en 9b1b4acaa98d9ce38cdd90fc573c3f4a1cda44e1, con los mismos once archivos tracked modificados y los archivos sin seguimiento encontrados al inicio. No se hizo stash, checkout, pull, reset, clean, commit, merge ni push. Fetch actualizó solamente referencias remotas: main remoto está en 54418b612dae37a83b804beddb0d68643eae12da y audit en 34790bd43434b9642db0e82e73da8c92d7aa46ea. El main local queda 26 commits detrás del remoto; eso no autoriza actualizarlo mientras esté sucio.

audit desciende directamente del main remoto. Sus tres commits son f13cf9a, f1d96b0 y 34790bd. Diferencia heredada: 59 archivos, 2381 inserciones y 124 eliminaciones, principalmente web, scores, Share, OTP/Turnstile y proyecciones de leaderboard. La rama aislada conserva esos commits y añade únicamente las correcciones y verificaciones descritas abajo. Un PR hacia main mostrará también esos 59 archivos: no es un PR exclusivo de FINALIZE.

Comparación de cambios locales existentes: environment.ts, model-vehicles.ts, vehicles.ts, world.ts, city.ts, admin.ts, package-lock.json y el billboard ya coinciden con la rama aislada (texto normalizado para CRLF). .env.example, globals.css, config.ts, index.ts, simulation.ts, package.json, start/finalize, authoritative-replay y la migración inicial difieren. AGENTS.md y CLAUDE.md existen solo en la carpeta original. Se conservaron todos en esa carpeta; no se copiaron encima del juego remoto rtw-v7 porque la API/replay/migración local antigua representan rtw-v2 y la simulación difiere. Cualquier integración futura de esos cambios requiere revisar su intención y versión; no hacer cherry-pick ciego ni actualizar main con pull/reset/clean.

## Archivos añadidos o modificados en esta preparación

| Archivo | Resultado |
| --- | --- |
| app/api/game-sessions/finalize/route.ts | SQLSTATE 42702 produce diagnóstico fijo finalize_sql_ambiguity, sin error del proveedor en logs ni respuesta pública. |
| lib/observability/security-event.ts | Añade ese motivo a la lista permitida. |
| lib/game/race-to-win/authoritative-replay.ts | Cuenta ticks fijos y compara el timestamp redondeado del próximo tick con el cap; evita mezclar timestamp ya redondeado con paso fraccionario. |
| supabase/migrations/20261010032418_fix_finalize_expired_lease_status.sql | Recupera exactamente las tres sentencias guardadas en TEST: CREATE OR REPLACE, REVOKE y GRANT. |
| supabase/verification/test-finalize-integration.sql | Fixtures de lease vencido con rollback; evidencia real, ownership, null digest, RLS/permisos, Top7 y total semanal. |
| tests/replay-tick-boundary.test.mjs | Replay real para veinte seeds al tick exacto, un ms antes y después; rechaza inputs/version/seed/cap inválidos. |
| tests/finalize-migration-regression.test.mjs | Calificación SQL, permisos, idempotencia estructural y diagnóstico seguro. |
| docs/test-finalize-pr.md | Descripción revisable del PR. |
| docs/test-finalize-integration.md | Este informe. |

No se cambiaron constantes de config, física, scoring, reglas, pagos/premios, dependencias ni sus archivos de lock. Esas rutas coinciden con main remoto salvo las diferencias web heredadas de audit ya enumeradas. No se escribió en Production ni se accedió a ella.

## Migración ordenada e idempotente

La última migración de audit es 20261005014540. TEST tiene una adicional: 20261010032418/fix_finalize_expired_lease_status. Se recuperó su SQL de supabase_migrations.schema_migrations, se generó inicialmente un archivo con la CLI migration new y se renombró al timestamp real ya aplicado; no se inventó un nuevo historial ni se modificó el remoto. Se conservan todas las migraciones históricas.

La corrección cambia solo la definición de FINALIZE y sus permisos. El UPDATE del lease vencido pasa de un status ambiguo a session.status. La excepción 23514 revierte ese UPDATE, como antes; NO queda persistido expired por esta RPC. No interpretar ese comportamiento como nueva regla ni prometer expiración persistente.

En TEST ya está instalada: omitir aplicación permanente. Para validar otra vez, con el conector fijado explícitamente a lndvnufmbuzdbinapvze, ejecutar BEGIN, el contenido de la migración dos veces, el bloque DO y SELECT del archivo de verificación, y ROLLBACK. El archivo de verificación por sí solo prueba la función instalada, no reejecuta DDL. Nunca ejecutar db push/reset/repair ni usar este paquete contra Production. Un plan Production requiere inventario y preflight propios; los preflight históricos de septiembre están fijados a un estado anterior y no deben reutilizarse ciegamente.

## Pruebas ejecutadas

- npm ci --ignore-scripts: dependencias fijadas instaladas en carpeta aislada.
- npm test: 81/81 PASS, cero omitidas. Incluye controles Zero Trust de identidad verificada, cuerpos limitados, evidencia ordenada, checkpoints privados, permisos, rutas y diagnósticos. Muchas pruebas heredadas inspeccionan código/SQL; no equivalen a una prueba HTTP adversarial completa.
- npm run typecheck: PASS.
- npm run lint: PASS tras corregir una variable del nuevo test.
- npm run build: PASS; Next.js 16.3.4, 28 páginas generadas. Sin credenciales ni archivo .env.local copiado del original.
- git diff --check: PASS.
- Checkpoints TEST: PASS con fixture temporal; aceptación de milestone 1000, retry exacto sin segunda renovación, una sola fila, conflicto rechazado con 23514 y propietario ajeno rechazado con P0002. Todo con ROLLBACK, sin finalizar el fixture ni activar derivaciones financieras.
- Supabase TEST: migración ejecutada DOS veces en una sola transacción con ROLLBACK. PASS: rama de lease vencido devuelve 23514 y no 42702; ownership devuelve P0002; digest nulo devuelve 22023; RPC solo service_role; RLS activa; browser sin autoridad de INSERT/UPDATE; Top7 <=7; sesión real en rango diario 1; suma semanal 25666.

Evidencia real leída en TEST: sesión d3bfe233-9b2e-4965-945f-fe4cc1520327, rtw-v7, seed 1959724101, input_count 283, elapsed/collision 608867 ms, score 7734, distance 77345061 mm, finalized, valid, siete checkpoints, daily_rank 1, weekly rank 1. El total semanal persistido y la suma de daily_top_scores son ambos 25666 para la semana 2026-10-05. La sesión rebasó expires_at histórico, pero su lease era válido al finalizar. No se retuvieron fixtures ni nuevas entradas de migración.

## Riesgos y límites antes de Production

1. npm audit: nueve paquetes afectados, ocho high y una critical. Next.js fijado en 16.3.4 aparece afectado, entre otros avisos, por GHSA-vcvr-r3jv-pc5j; sharp y dependencias de tooling también tienen avisos. No se ejecutó audit fix ni se hizo downgrade. Revisar alcance y actualizar con regresión propia antes de promover.
2. No están disponibles los 283 inputs completos de la sesión real; su resultado y derivaciones se verificaron en SQL, pero no se reconstruyó esa partida exacta. El test de replay usa veinte partidas reproducibles diferentes.
3. No se probó una instalación fresca de TODA la cadena histórica ni se validó un catálogo Production. La prueba de migración cubre el upgrade real de TEST y su repetición; los archivos históricos no son todos reejecutables.
4. No hubo prueba de navegador ni E2E HTTP con JWT real en esta preparación. La evidencia de la partida es real, y los controles automatizados tienen el alcance descrito arriba.
5. El PR incluye audit completo. Revisar sus cambios de OTP/Turnstile, textos guest y leaderboard, además de este delta. No se cambió ninguna fórmula de juego en este trabajo.
6. No existe .github/workflows ni vercel.json en la rama; la configuración de despliegue externa no se verificó. Antes del push del usuario, confirmar que esta rama no sea una rama de despliegue Production en el proveedor.

## Entrega y transferencia

Estamos en el Windows local: ambas carpetas pertenecen al mismo repositorio mediante git worktree. VS Code debe abrir la carpeta aislada para commit/push, manteniendo la carpeta original intacta. El script entregado en outputs valida ruta, rama, remoto y lista explícita de archivos; no agrega supabase/.temp, secretos ni cambios de main.

Si otro Work está en una máquina distinta, las carpetas NO se comparten. Tras tu commit/push autorizado, allí pueden clonar el repositorio en una carpeta NUEVA y seleccionar integration/test-finalize-20261010. Sin push, transferir un git bundle creado después del commit más el informe; verificar su SHA-256, importar en un clone nuevo y probar allí. Nunca indicar pull/reset/clean sobre el main sucio ni copiar .env.local o service keys.

El estado está listo para commit y PR draft revisable, NO para despliegue Production automático.

SHA-256 del archivo de migración entregado: 268313F1F359C6439826945C7F3E4823EEF3CE2EB1383A007C8B10014B5C5388.
