# Entorno local oficial de Race To Win

Work, Codex y ChatGPT deben usar esta misma configuración. No abrir otra carpeta ni cambiar de puerto para resolver un fallo.

- Carpeta: `C:\Users\crist\Documents\Codex\race2win-readiness-20261010`
- Rama: `fix/production-readiness-20261010`
- Commit base comprobado: `cc6aba298431c246aa38ce29bd794a6686e62d78`. La guía y el lanzador se prepararon después, sin commit. Consultar siempre `git rev-parse HEAD` y `git status --short`; no resetear avances para volver al hash.
- URL: `http://localhost:3000`; puerto obligatorio 3000.
- Supabase exclusivo: TEST `lndvnufmbuzdbinapvze`. Production `fspszgqmwhwfoiitnerp` está fuera de alcance.
- La carpeta principal `race2win.app` conserva cambios sin commit; no iniciar desde ella ni modificarla.

## Estado comprobado el 11 octubre 2026

El proceso que escuchaba en 3000, PID 22852, cargaba Next desde esta carpeta oficial. No se cerró. Sólo existe `.env.example` aquí; la carpeta principal tiene `.env.local`, con URL TEST y clave pública, pero sin las dos variables server-side requeridas (clave de servidor y HMAC). No se copió ni modificó su archivo.

El servidor abierto respondió 503 en `/api/leaderboard`, cuya comprobación indica URL o service key ausente. El flujo OTP necesita además `RTW_ABUSE_HMAC_KEY` para su límite previo a Auth. La configuración incompleta es un bloqueo confirmado antes de SMTP. No se certificó la configuración SMTP actual de TEST con el acceso disponible.

La consulta GET pública de Supabase Auth TEST devolvió 200 usando la clave pública de la carpeta principal sin modificarla: Email habilitado, signup habilitado y mailer_autoconfirm=true. Confirma la pareja URL/clave pública de ese archivo; NO configura el servidor oficial ni demuestra la pertenencia de una service key aún ausente. SMTP/contraseña y cuotas no se exponen en este endpoint y quedan pendientes de revisión en el dashboard TEST.

Resend: ocho mensajes recientes figuran delivered; los ocho envíos de SMTP devolvieron 200. No prueba que la configuración actual de TEST sea idéntica ni descarta errores futuros. Los logs TEST disponibles no muestran peticiones OTP en su ventana consultada. No se enviaron correos durante esta investigación. La respuesta pública 202 es neutra y NO significa que salió un correo; `nextStep=false` tampoco autoriza entrar en la pantalla de verificación.

## Configurar una sola vez, en privado

Actualización: `.env.local` ya fue creado en esta carpeta con URL TEST, clave pública contrastada con las claves habilitadas del conector TEST y HMAC local criptográfica. Falta únicamente la credencial administrativa de Supabase; no regenerar HMAC ni sobrescribir el archivo. Obtener la secret/service_role existente de Settings → API Keys del proyecto TEST y pegarla en privado en SUPABASE_SERVICE_ROLE_KEY. SMTP y cuotas actuales requieren comprobación del dashboard antes de un único envío. No se envió OTP ni se reinició el servidor durante esta preparación.

Crear/editar `.env.local` sólo en la carpeta oficial (ignorado por Git). Obtener las claves del panel de TEST, nunca del proyecto Production. No pegarlas en chats, capturas, PowerShell ni logs.

Para crear la plantilla sin sobrescribir ningún archivo existente:

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item -LiteralPath '.env.example' -Destination '.env.local' }
code .env.local
```

Completar las tres variables Supabase con los valores del mismo TEST en el editor privado. Para generar la HMAC local sin imprimirla, sólo si su línea está vacía:

```powershell
node -e "const fs=require('node:fs'),crypto=require('node:crypto');const p='.env.local';const s=fs.readFileSync(p,'utf8');if(!/^RTW_ABUSE_HMAC_KEY=\s*$/m.test(s))throw Error('HMAC ya configurada o linea ausente; no sobrescribir');fs.writeFileSync(p,s.replace(/^RTW_ABUSE_HMAC_KEY=\s*$/m,'RTW_ABUSE_HMAC_KEY='+crypto.randomBytes(32).toString('hex')));"
```

No ejecutar ese comando desde otra carpeta. No regenerar la HMAC en cada prueba: invalidaría desafíos y cambiaría buckets del limitador. Reiniciar el servidor oficial después de completar el archivo.

Requeridas: `NEXT_PUBLIC_SUPABASE_URL=https://lndvnufmbuzdbinapvze.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, y una `RTW_ABUSE_HMAC_KEY` local persistente de al menos 32 bytes. La clave de servidor y HMAC nunca llevan prefijo NEXT_PUBLIC_. No añadir una RESEND_API_KEY al navegador: el SMTP de Auth se configura dentro de Supabase TEST.

Definir explícitamente `TURNSTILE_ENFORCEMENT_ENABLED` según la configuración de prueba acordada; no desactivarlo para saltar una comprobación. Si está habilitado, comprobar site/secret del mismo widget, acción otp_request y host localhost permitido en Cloudflare y en el validador del servidor. Se corrigió la allowlist para admitir localhost exclusivamente en development; Production lo sigue rechazando. La validación de proveedor, hostname exacto y acción sigue obligatoria. No afirmar que está activo sólo porque funciona en otro entorno.

El entorno heredado de PowerShell tiene prioridad sobre los archivos de Next. Evitar variables globales de Production; el lanzador revisa valores efectivos y rechaza conexiones alternativas. Si alguna comprobación no puede realizarse, no inicia el servidor. Las comprobaciones de credenciales sólo usan GET contra TEST; no envían emails ni escriben datos.

## Comandos únicos

Comprobar configuración efectiva (sin mostrar claves):

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
node .\scripts\local-test.mjs check
```

Iniciar (si 3000 está libre y la configuración pasa):

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
npm.cmd run dev
```

`npm run dev` usa el lanzador oficial con puerto explícito. No inicia en 3001/3002. Si 3000 está ocupado, no mata procesos y se detiene. No ejecutar directamente next dev para evitar estas guardas.

Comprobar carpeta, rama, commit y proceso de 3000:

Atajo único: `& .\scripts\check-local-server.ps1` desde la carpeta oficial. No detiene procesos ni muestra CommandLine completa. Si faltan permisos, se detiene sin declarar libre el puerto. La versión expandida equivalente es:

```powershell
Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
foreach ($taskListener in $taskListeners) {
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskListener.OwningProcess)"
  $taskOfficialPath = 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010\'
  [pscustomobject]@{Port=3000;PID=$taskProcess.ProcessId;ParentPID=$taskProcess.ParentProcessId;Name=$taskProcess.Name;OfficialFolder=$taskProcess.CommandLine.Contains($taskOfficialPath)}
}
```

No imprimir CommandLine completa: podría contener secretos de otros procesos. Si OfficialFolder es false, investigar padres y no cerrar nada automáticamente. Si falta acceso para consultar procesos, usar PowerShell con permiso de lectura adecuado, no asumir que el puerto está libre.

Detener: pulsar **Ctrl+C en la terminal que inició este servidor**. Confirmar que el listener de 3000 desapareció. No usar taskkill de todos los node.exe ni cerrar la terminal de la carpeta principal. Si no encuentras la terminal, identificar PID/carpeta nuevamente antes de cualquier parada dirigida.

## Una prueba OTP, con diagnóstico

1. Pasar el check y reiniciar desde la carpeta oficial; Next no hereda cambios posteriores de otra terminal.
2. En Supabase TEST, revisar Authentication: Email habilitado, SMTP Resend activo, remitente/dominio autorizado, host/puerto/usuario correctos y estado de la credencial SMTP, sin revelar contraseña. Revisar Site URL/redirects para localhost:3000 y plantilla de OTP; no asumir que Production tiene los mismos valores. No cambiar límites durante el diagnóstico.
3. Revisar los límites actuales de Supabase Auth y las cuotas reales del plan Resend. Si no se puede descartar cargos adicionales, detenerse antes de enviar.
4. Abrir únicamente http://localhost:3000/sign-in. Usar un buzón propio de prueba y solicitar UN código. En Network comprobar `/api/auth/request-code`, 202 y nextStep; no compartir cookies ni OTP.
5. Correlacionar hora y requestId con logs del servidor: missing_configuration/abuse_protection_unavailable = entorno; rate_limited/provider_rate_limited = límites; provider_unavailable = transporte; provider_rejected = Auth/Turnstile. Consultar el motivo exacto en código y logs, sin publicar datos privados.
6. Si Auth registró la petición, revisar Supabase TEST Auth Logs. Si SMTP aceptó el envío, revisar Resend: accepted/delivered/bounced/suppressed/deferred. No repetir clicks para investigar. Esperar cooldown y analizar antes de un nuevo intento.
7. Escribir el código únicamente en la página local; verificar acceso autenticado y revocación. El guardado oficial requiere Auth real: no desactivar Zero Trust.

## Reglas para futuras sesiones

Leer esta guía, comprobar carpeta/branch/HEAD/listener/configuración. No crear otra rama/carpeta, no usar puertos alternativos, no exponer secretos, no modificar premios/pagos/reglas. No push, merge, deploy ni migración de Production sin el alcance autorizado. Conservar el cambio previo generado en next-env.d.ts; no sobrescribirlo para limpiar el working tree.
