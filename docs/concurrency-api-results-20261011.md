# Concurrencia por API TEST — preparación y evidencia

Estado: NO APROBADA como concurrencia. Carpeta oficial, rama
`fix/production-readiness-20261010`, avances anteriores preservados.
No se ejecutó auditoría ofensiva ni Codex Security.

## Intento posterior a la autorización del propietario

El propietario autorizó setup, los cuatro RPC y cleanup exclusivamente TEST.
Se repitió el preflight HTTPS antes de escrituras: HTTP 0,
TRANSPORT_UNAVAILABLE, BLOCKED_BEFORE_WRITES. No se creó ningún fixture
persistente, no se ejecutó ningún RPC y no se ejecutó ningún DELETE.
Una consulta de solo lectura confirmó cero usuarios/sesiones/resultados del
manifiesto, cero filas en la semana aislada (resultados, Top7, total semanal,
ganadores), y cero ledger/balances/payouts para las identidades del ensayo.
La autorización sigue vigente; falta coordinar un ejecutor HTTPS accesible
desde el PowerShell del propietario antes de crear fixtures.

## Archivos preparados

- `scripts/test-concurrency-api.mjs`: --prepare genera solo archivos locales;
  --check es solo lectura; --execute requiere confirmación explícita de cuota
  sin cargos adicionales. TEST exacto, TLS validado, conexión HTTPS independiente
  por solicitud, máximo dos solicitudes por carrera y cuatro en el limitador.
- `supabase/verification/concurrency-api-manifest.json`: dos UUID de usuario,
  15 sesiones, seeds e inputs sintéticos, resultados calculados por el replay
  real del repositorio. Sin claves, passwords, correos reales ni JWT.
- `concurrency-api-setup.sql` y `concurrency-api-cleanup.sql`, en la misma carpeta
  de verificación: requieren conector/SQL Editor autorizado en TEST. La API
  administrativa no tiene DELETE de sesiones/resultados, confirmado por SQL;
  no se ampliaron permisos para facilitar la limpieza.
- Regresiones de opt-in, rechazo de Production y barrera previa de costos.

El ejecutor verifica la marca app_metadata de ambas identidades por Auth Admin,
sesiones exactas, propietario, gameId, seed, gameplay, estado y fecha antes de
mutaciones. Solo permite cuatro RPC enumerados; no admite RPC de premios,
pagos, balances o administradores de competición. Un cliente con clave pública
se usa únicamente para probar rechazo del RPC de finalización.

## Revisiones y correcciones de la preparación

La semana inicialmente elegida (2099-01-05) tenía datos preexistentes. La
precondición abortó antes de insertar fixtures. No se inspeccionaron identidades
ni se borraron datos de esa semana. Se verificó vacía la semana correspondiente
a 2099-02-09T16:00:00Z y se actualizó solo el plan local nuevo.

La lease inicial se ajustó de 30 a seis minutos: una lease de 30 minutos impediría
la renovación canónica de seis minutos. Ejecutar las carreras inmediatamente
después del setup; si expira, detenerse y limpiar exactos UUID, no renovar o
editar reglas para pasar. En el ensayo secuencial de una sola transacción se
usó una lease de un minuto, pues now() es fijo dentro de una transacción.

No se encontró ni corrigió una vulnerabilidad confirmada del juego.

## Probado realmente en Supabase TEST

Ensayo SQL SECUENCIAL de una transacción, con ROLLBACK al final:
- Inserción de dos identidades y 15 sesiones sintéticas aisladas.
- Once FINALIZE con resultados del replay calculado localmente.
- FINALIZE duplicado rechazado con check_violation; un resultado por sesión.
- Diez partidas del primer usuario producen exactamente siete Top7, suma
  semanal esperada y vector de diez partidas completo.
- Checkpoint idéntico repetido deja una sola fila; digest contradictorio rechazado.
- Ausencia de ganadores, ledger, balances y payouts para las identidades sintéticas.
- Resultado devuelto: assertions completed; rolled back; usuarios=0, sesiones=0.

El ensayo adicional del script de limpieza fue CANCELADO. No se declaró
aprobado ni se repitieron escrituras después de esa cancelación. Una consulta
posterior confirmó usuarios=0, sesiones=0, resultados=0 y ledger=0 para los
UUID exactos. No quedaron fixtures persistentes de esta ejecución.

El usuario confirmó que la API es accesible desde su PowerShell. Desde esta
sesión, --check terminó BLOCKED_BEFORE_WRITES, HTTP 0, TRANSPORT_UNAVAILABLE.
Por tanto NO se ejecutaron las carreras simultáneas por API y NO existe un
resultado alojado aprobado del ejecutor.

Validación local ejecutada: seis pruebas específicas pasaron, sintaxis pasó,
ESLint pasó y git diff --check pasó. Estas pruebas incluyen replay y guardas
del ejecutor; no son pruebas de concurrencia alojada. No se volvió a correr
innecesariamente la suite larga completa anterior.

## Casos alojados preparados pero pendientes

- FINALIZE simultáneo idéntico/contradictorio, retry y resultado canónico.
- Límites SQL de score negativo, input_count>4096 y colisión después del tiempo.
- Checkpoint idéntico/contradictorio y checkpoint contra FINALIZE.
- Cinco parejas de FINALIZE para una misma semana, unicidad y recálculo completo.
- Veinte solicitudes sintéticas al limitador, máximo cuatro en vuelo; la
  alineación de ventanas SQL no puede deducirse solo del reloj del cliente.
- ACL pública y cero escrituras financieras derivadas para los fixtures.

La prueba checkpoint versus FINALIZE utiliza un milestone privilegiado de
1000 puntos para inspeccionar atomicidad de SQL. Se identifica explícitamente
como fixture, NO como puntuación aprobada por replay. RPC privilegiado confía
en la evidencia del servidor; la ruta HTTP es quien calcula/valida el replay.
No confundir esa llamada de prueba con autorización del navegador.

No generar premios/ledger para demostrar ausencia de duplicaciones: los
créditos, recompensas y balances bajo carrera quedan pendientes. Comprobar
que permanecen vacíos solo demuestra ausencia de efectos de este ensayo.
También faltan JWT/HTTP autenticado y evidencia de pg_blocking_pids/locks en
transacciones realmente simultáneas. Solapamiento HTTPS NO demuestra eso.

## Siguiente paso seguro

En PowerShell de la carpeta oficial:

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
node scripts/test-concurrency-api.mjs --check
```

No cambia datos ni envía correos. Después coordinar setup/ejecución/cleanup
en TEST en la misma sesión, con cuota sin cargos verificada. No ejecutar
setup si no está asegurada la limpieza por SQL autorizado. No ejecutar --prepare
otra vez ni sobrescribir el manifiesto vigente. No cambiar passwords o grants.
--execute escribe un informe sin secretos en concurrency-api-results.json y
marca cleanupRequired; jamás limpia por API con permisos ampliados.
La variable RTW_TEST_FREE_QUOTA_CONFIRMED es una barrera humana, no una lectura
de facturación ni prueba automática de ausencia de cargos. No marcarla true
sin verificar la cuota/límites existentes. No crear recursos nuevos para resolverlo.
