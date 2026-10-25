# Reglas permanentes: Race To Win y FlappyRace

## Alcance y estado

Estas son reglas confirmadas de seguridad y competición para ambos juegos.
Son requisitos, no una declaración de implementación ni autorización de despliegue.
Antes de cambiar una función, verificar el código, las pruebas y el estado del
entorno correspondiente. Distinguir siempre: implementado en código, probado,
aplicado en base de datos y activo en producción; no son equivalentes.

La revisión documental base es main en 21c254d03d799b63d528cdb2e4a5b785783530bd:
- Race To Win tiene simulación/replay y sesiones propias; esto no certifica
  ausencia de vulnerabilidades ni el estado de producción.
- FlappyRace tiene ranking de lectura y partidas de práctica. Su validación
  autoritativa, escritor oficial y torneo competitivo siguen pendientes.
- No importar resultados de práctica como partidas oficiales verificadas.
- La integración de anuncios recompensados/SSV y EXTRA LIFE sigue pendiente
  según la documentación citada. No anunciarla ni activarla por esta regla.
- Ideas futuras como nuevos detectores de bots, proveedores de anuncios o
  mecanismos adicionales requieren diseño, revisión y pruebas propios.
  No convertir una propuesta o una variable de entorno en evidencia de seguridad.

## Zero Trust y autoridad del servidor

- Tratar el navegador como no confiable: DOM, memoria, almacenamiento, reloj,
  score, posición, colisiones, entradas, usuario y mensajes pueden manipularse.
- El servidor debe recalcular y decidir score, colisiones, fin de partida y
  elegibilidad competitiva con simulación determinista versionada por juego.
  Un score enviado por el cliente o un replay físicamente válido no prueban
  por sí solos una partida humana.
- Emitir sesiones oficiales desde el servidor, ligadas al usuario autenticado,
  game_id, versión y semilla impredecible. Verificar firma/claims y sesión Auth
  vigente, propiedad, expiración y estado en cada operación protegida.
  No confiar en user_id ni en autorización declarados por el navegador.
- Validar tamaños, secuencia, tiempos, liveness y límites de las pruebas de entrada.
  No reutilizar el validador de Race To Win como prueba de validez de FlappyRace.
- Autorizar y consumir vidas extra/recompensas en servidor de forma atómica.
  Si dependen de anuncios, exigir verificación real servidor a servidor y prueba
  única vinculada a la sesión; un callback del navegador no concede una vida.

## Persistencia, anti-replay y datos

- Finalizar una sesión y materializar su resultado una sola vez en una transacción.
  Exigir anti-replay e idempotencia persistentes para checkpoints, finalizaciones,
  recompensas y operaciones administrativas; proteger también carreras concurrentes.
  Un duplicado no debe sumar score, conceder vidas ni repetir efectos.
- Aplicar cuotas y límites persistentes compartidos entre procesos/instancias,
  con consumo atómico y reloj del servidor. Memoria local, localStorage o reinicios
  no deben permitir eludirlos. Conservar la política vigente; cambiarla requiere
  alcance explícito y no se deduce de estas reglas.
- Mantener RLS y mínimo privilegio en tablas, vistas y RPC. Los roles del navegador
  no deben escribir ni acceder directamente a sesiones, resultados verificados,
  fraude, premios o pagos; exponer solo lecturas públicas expresamente restringidas.
- El acceso privilegiado debe ser server-only, con autorización en cada operación.
  Restringir grants, ejecución y search_path de funciones privilegiadas.
  No desactivar RLS ni ampliar permisos para hacer pasar una prueba.
- Mantener claves privilegiadas, secretos de firma, webhook y credenciales fuera
  del bundle, variables NEXT_PUBLIC_, respuestas, logs y documentación.
  No confundir configuración pública de conexión con credenciales privilegiadas.

## Antifraude y bots predictivos

- Considerar bots que juegan legalmente usando semillas, obstáculos o snapshots
  visibles. Un replay válido, CAPTCHA o Turnstile no garantizan juego humano.
- Conservar pruebas adversariales de automatización y evaluar señales de abuso,
  temporización, reuso de pruebas y comportamiento. Registrar evidencia suficiente
  para revisión sin filtrar secretos; no presentar una heurística como certeza.
- Retener resultados sospechosos para revisión según el flujo autorizado.
  No borrar evidencia ni conceder premios automáticamente por pasar el replay.

## Rankings, desempates y aprobación humana

- Mantener clasificaciones independientes por game_id en consultas, escrituras,
  agregaciones y revisión; FlappyRace no debe alterar resultados de Race To Win.
- El total diario suma las 7 mejores partidas oficiales verificadas elegibles.
  El semanal suma los totales de lunes a domingo, hasta 49 partidas.
  Derivar día y semana en servidor/base de datos con America/New_York y sus
  cambios DST; no usar el reloj o zona horaria del navegador.
- Conservar los desempates oficiales existentes, incluidos vectores de scores
  individuales descendentes. No inventar criterios ni resolver empates absolutos
  por orden de consulta, nombre o ID. Mantenerlos pendientes de revisión manual;
  en FlappyRace no mostrar rango numérico ni ganador de podio para empate exacto.
- Ranking y ganador provisional no autorizan adjudicación definitiva ni pago.
  Exigir aprobación humana de un admin autorizado y comprobado en servidor,
  evidencia y auditoría para las decisiones sensibles.
- No activar premios ni pagos automáticos. Conservar el flujo manual y las
  garantías del ledger existente; un job, agente o clasificación no sustituye
  la aprobación humana.

## Activación, pruebas y conservación del proyecto

- No activar un torneo sin validación autoritativa completa específica del juego,
  antifraude revisado y pruebas de integración en PostgreSQL real.
  Un flag, catálogo, UI o ranking de lectura no habilitan competición segura.
- Para habilitar o cambiar escrituras competitivas, demostrar en un entorno
  aislado/autorizado RLS y grants con roles reales, ownership, expiración,
  anti-replay, idempotencia concurrente, cuotas, aislamiento por game_id,
  top 7, semana/DST y desempates. Probar migraciones cuando corresponda.
  Mocks y comprobaciones de texto SQL no sustituyen PostgreSQL real.
- No afirmar que las pruebas locales certifican el estado de producción.
  Si falta evidencia, documentar el bloqueo y mantener la función inactiva.
- Preservar código, datos, migraciones históricas y cambios ajenos al alcance.
  No resetear, sobrescribir o revertir trabajo no relacionado.
  No copiar infraestructura entre juegos sin comprobar sus contratos y efectos.
- Un cambio de reglas/documentación no autoriza código funcional, migraciones,
  cambios de configuración, activaciones, premios ni despliegues. Validar el diff
  y reportar exactamente los archivos y pruebas; no reparar asuntos ajenos.

## Referencias y límites de evidencia

- [Estado específico de FlappyRace](../docs/flappy-weekly-ranking.md).
- [Fundación competitiva](../docs/competition-foundation.md): documento de su fase,
  no inventario actualizado de producción.
- [Verificación humana y sus límites](../docs/midrun-human-verification.md).
- [Procedimiento PostgreSQL](../supabase/verification/README.md): respetar su
  entorno y autorización; esta regla no autoriza ejecutarlo contra producción.
- [Prueba adversarial predictiva](../tests/predictive-driver-adversarial.test.mjs).
