# Race To Win / FlappyRace: antifraude, 26 octubre 2026

## Alcance y auditoría

Repositorio `dkny-ops/race2win.app`, main. Producción Vercel
`prj_8GKiG18JWvmYExZIeyaqftoRdO6V`, dominio www.racetowin.app.
La variable pública de producción confirma Supabase `lndvnufmbuzdbinapvze`.
No se modifica `fspszgqmwhwfoiitnerp`.

Confirmado en código y catálogo de producción antes del cambio:

- Replay específico de cada juego, semillas del servidor, checkpoints, leases,
  finalización e incorporación automática de resultados válidos. El replay no
  demuestra que jugó una persona.
- Cuotas persistentes: RTW inicio/acciones; Flappy `flappy_consume_quota`.
  OTP reutiliza cuotas HMAC y Turnstile. No se añade otro rate limiter.
- Tablas competitivas públicas con RLS y sin INSERT/UPDATE/DELETE de anon o
  authenticated. Tablas de Flappy privadas; RPCs administrativas restringidas.
- Top siete diario, acumulación semanal NY, desempates y expedientes Flappy.
- Aprobación administrativa existente y ledger separado del ranking; ausencia
  de aprobación humana por partida ordinaria.
- Auth mantiene el índice único de correo no SSO. La comprobación normalizada
  previa al cambio encontró cero grupos de correos verificados duplicados.

Esta es una auditoría focalizada de los contratos afectados. No es certificación
exhaustiva de ausencia de vulnerabilidades ni de humanidad de las partidas.
Las referencias auxiliares del paquete de escaneo Codex Security no estuvieron
accesibles; no se declara completado un escaneo formal de ese paquete.

## Cambio

- Comprobación de correo verificado y coincidencia normalizada con otra cuenta
  con perfil competitivo, tanto al iniciar como al finalizar. Rechaza esa
  identidad competitiva, sin suspender permanentemente la cuenta. No se modifica
  Auth ni se intenta fusionar cuentas automáticamente.
- Evidencia compartida para los dos juegos: HMAC diario de IP confiable de Vercel,
  sin IP cruda, prefijos de red, huella, identificadores de dispositivo o cookies
  de seguimiento. Nunca se confía en X-Forwarded-For del cliente. Sin encabezado
  confiable no se inventa una señal. Usa la clave HMAC existente con otro dominio.
- Las conexiones compartidas son informativas y jamás causan bloqueo, hold o
  descalificación. Contactos de cobro coincidentes son declarados por usuarios,
  no prueban identidad. Ambas fuentes se muestran como pistas administrativas.
- Conflicto de correo verificado: evidencia en `fraud_flags` existente; sin
  duplicados por jugador/juego durante 30 días. No se almacenan los correos en
  esa evidencia. Un correo único tampoco acredita una persona única.
- Expedientes privados de ambos juegos muestran relaciones y señales. Lectura
  exige administrador activo, RPC solo service_role y autorización del dueño
  en la página. No se devuelven IP/HMAC/contactos de cobro al navegador; el ranking
  público no recibe relaciones ni señales privadas.
- RTW prepara automáticamente candidatos de la semana cerrada (05:25 UTC cada
  día, siempre calculando semana NY). Solo crea registros provisionales, nunca
  crédito o pago. El panel presenta hasta tres candidatos y permite rechazo con
  motivo. El siguiente elegible ocupa la plaza vacante; los demás conservan su
  importe. Empates absolutos continúan pendientes de resolución manual.
- Historial RTW añade decisiones futuras a las transiciones existentes dentro
  de la misma transacción. No se inventa historial anterior; se conserva estado
  previo. Rechazo de un premio ya acreditado o pagado exige el flujo financiero
  existente; no se sustituye automáticamente mientras exista ese compromiso.
- Flappy mantiene su cierre y sustitución existentes. El panel filtra las tarjetas
  a los tres candidatos actuales; cada expediente conserva su historial.
- Se conservan importes RTW (1500/300/200 centavos), ledger y aprobación final
  manual. No se activan premios, saldo ni pagos de Flappy.
- Validación de origen y cuerpo vacío en inicio RTW; validación de origen en
  aprobación de saldo. No se aceptan autoridad ni puntuaciones del navegador.
- Se elimina el bloque del footer mostrado en la captura: logotipo, título y
  “High-speed competition is coming.” Los enlaces legales permanecen.

## Retención

`private.competition_network_evidence` es nueva porque ninguna tabla existente
representa relaciones de red para ambos juegos. Deduplica por jugador, juego,
día y HMAC. RLS sin acceso directo de navegador ni service_role; escritura por
RPC acotada. Consulta administrativa limita señales a 30 días. Borrado diario
04:17 UTC; almacenamiento físico hasta la siguiente ejecución (aprox. 31 días).
La ejecución real depende de pg_cron, confirmado instalado en producción.
Historial de decisiones y fraude existente se conserva como auditoría; no contiene
IP cruda ni los HMAC de red. Evidencia de red no es retroactiva.

## Pendiente de proveedor externo

No se encontró proveedor de reputación IP configurado. **No están implementadas
ni activas la detección comercial de VPN, proxies anónimos o centros de datos,
ni la denegación por esas clasificaciones.** No se usa ASN, IP compartida o una
lista improvisada como sustituto. No se ha contratado ni llamado a un proveedor.

Para la siguiente fase se debe seleccionar un proveedor con detección separada
VPN/proxy/hosting/móvil, precisión y confianza documentadas, condiciones de
tratamiento de IP, cuota gratuita o coste aprobado, timeouts, caché y procedimiento
ante fallos. Requiere autorización antes de contratar o activar. Una señal de
hosting sola no basta para bloquear; VPN/proxy de alta confianza debe denegar solo
el inicio oficial, explicar cómo reintentar con otra conexión y no sancionar cuenta.

Las señales actuales son heurísticas de relación, no identificación universal de
personas ni detección completa de automatización. No hay fingerprint invasivo.

## Migración y verificación

Solo `20261026180259_competitive_identity_evidence.sql`, creada con Supabase CLI.
Aplicación puntual mediante API; sin db push, repair, reset ni cambios del historial
anterior. Fecha remota y despliegue se registran en el informe de publicación.

Pruebas reproducibles:

```sh
node --test --test-isolation=none tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
PSQL_BIN=/ruta/psql python3 tests/integration/competition-identity.py
```

PostgreSQL nativo 17.11, cluster exclusivo 127.0.0.1:55439: todas las migraciones
históricas en orden, identidad, inicios oficiales, conexiones compartidas sin
bloqueo, no exposición de contactos/HMAC, retención, roles reales, Top 7 Flappy,
cierre y sustitución en ambos juegos, idempotencia y ausencia de efectos
financieros. 30 llamadas concurrentes de service_role guardan una sola evidencia.
Auth es scaffold SQL, no GoTrue; cron es scaffold de registro de schedules, no
prueba de ejecución del scheduler. Pruebas de integración nunca contra producción.

La suite Node se ejecuta sin aislamiento de procesos porque el sandbox inicial
podía producir subprocesos Node sin salida; el resultado válido cuenta pruebas
individuales, no solo archivos. Build completo funciona con permiso de red del
sandbox. Lint general arrastra 21 errores en código previo; revisión de archivos
nuevos y rutas afectadas se reporta por separado, sin reparar asuntos ajenos.

## Resultado de aplicación

- Migración remota aplicada: **20261026182337 / competitive_identity_evidence**.
  SQL local SHA-256:
  `d6e5cb1636655cda3508c8c4ea5b52227a9be4dd23a6ef6a5bee32ce838e40e2`.
- Postflight: dos triggers de identidad, RLS activado en ambas tablas nuevas,
  cero acceso directo de anon/authenticated/service_role a esas tablas y cero
  EXECUTE del navegador en las cuatro RPC nuevas. Usuario inexistente/sin correo
  verificado rechazado por la RPC real sin escribir fixtures en producción.
- Tres schedules comprobados activos: cierre Flappy existente, preparación RTW
  y retención. No se ha observado todavía su primera ejecución programada.
- Advisors después: sin ERROR; INFO por RLS sin políticas en tablas privadas
  intencionalmente inaccesibles. Advertencia previa sobre contraseñas filtradas
  desactivada en Auth, sin cambiar configuración de acceso por correo OTP.
  [Referencia del advisor](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- 111 pruebas individuales Node correctas; TypeScript y build correctos;
  integración nativa y concurrencia correctas. Lint dirigido correcto; lint
  completo mantiene los 21 errores previos documentados.
