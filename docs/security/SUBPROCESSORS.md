# ORBIT NEXUS — Inventario de proveedores

Inventario detectado desde el repositorio y su configuración (10/2026). No se agregan
proveedores supuestos. La clasificación jurídica de cada flujo (encargado, transferencia,
destinatario por instrucción del usuario) está pendiente (`docs/legal/OPEN-LEGAL-ITEMS.md` §5).

- **CONFIRMED**: en uso, con evidencia en código o documentación de producción.
- **PLANNED**: decidido para una fase futura; no se usa hoy.
- **UNKNOWN**: la integración existe en código y es configurable, pero el proveedor concreto no
  está identificado en el repositorio. Mientras no se configure, ORBIT muestra un estado "no
  configurado" y no envía datos.

## CONFIRMED

| Proveedor | Finalidad | Datos posibles | Ambiente | Secreto/config | Salida |
|---|---|---|---|---|---|
| Vercel | Hosting y ejecución de la aplicación, logs de funciones | Todo el tráfico HTTP (incluidos uploads y respuestas), logs de error redactados | Producción y preview | Variables de entorno del proyecto; `VERCEL`, `VERCEL_ENV` | Next.js estándar: migrable a otro hosting Node; revisar headers (`next.config.ts`) y `BETTER_AUTH_URL` |
| Neon (PostgreSQL) | Base de datos de producción, incluidos los documentos privados (`Document.content`) | Todos los datos persistentes: cuentas, sesiones, datos fiscales, documentos, auditoría | Producción | `DATABASE_URL` | Volcado con `pg_dump` y restauración en otro PostgreSQL; migraciones Prisma versionadas (`BACKUP-RESTORE.md`) |
| GitHub | Repositorio de código, secret scanning, Dependabot | Código y configuración. **No debe contener datos de clientes ni secretos** (`npm run security:check`) | Desarrollo | Credenciales de desarrolladores (fuera de la app) | Git es portable |

Sin transferencia en tiempo de ejecución:

- Google Fonts: `next/font/google` descarga Geist durante el build y la sirve desde el propio
  dominio; el navegador del usuario no contacta a Google.
- SAT: los catálogos se descargaron manualmente y se versionan en el repositorio; ORBIT no
  consulta al SAT en tiempo de ejecución.
- Registro npm: dependencias en build; no recibe datos de usuarios.

## UNKNOWN (integraciones configurables sin proveedor identificado)

| Integración | Finalidad | Datos que recibiría | Ambiente | Secreto/config | Salida |
|---|---|---|---|---|---|
| OCR de tickets | Leer tickets cuando el usuario solicita el análisis | Imagen o PDF del ticket | Producción si se configura | `OCR_API_URL`, `OCR_API_TOKEN` | Vaciar las variables: el flujo vuelve a captura manual |
| Correo transaccional | Enlace de recuperación de contraseña | Correo del usuario y URL de restablecimiento (token de un solo uso) | Producción si se configura | `MAIL_API_URL`, `MAIL_API_TOKEN` | Vaciar las variables: la recuperación se muestra como no disponible |
| Worker de automatización de portales | Llenar y enviar portales de facturación después de la aprobación humana | Contexto de billing: RFC, razón social, régimen, CP, uso CFDI, correo fiscal, datos del ticket | Producción si se configura | `BILLING_AUTOMATION_URL`, `BILLING_AUTOMATION_TOKEN`, `BILLING_AUTOMATION_ADAPTERS` | Vaciar las variables: flujo manual/asistido |

Destinatarios por instrucción del usuario (no son proveedores de ORBIT): los portales de
facturación de cada comercio reciben los datos fiscales necesarios solo cuando el usuario
aprueba el envío.

## PLANNED

| Proveedor | Finalidad | Datos | Estado |
|---|---|---|---|
| SW sapien / SmarterWEB (PAC) | Timbrado de CFDI previamente sellado (Fase 5C, D6) | XML sellado del CFDI, credenciales de PAC | No implementado. Sin credenciales. No inventar endpoints |
| Antivirus de documentos | Escaneo de uploads | Archivos subidos | Sin decidir; existe la frontera `src/lib/security/malware-scan.ts` |
| Vercel Firewall | Rate limiting en el borde | Metadatos de solicitudes | Recomendación; no activado |

No existen proveedores de analytics, publicidad, pagos ni monitoreo de errores (por ejemplo,
Sentry). Agregar cualquiera requiere actualizar este inventario, el Aviso de Privacidad y, si
aplica, el consentimiento de cookies.

## Al incorporar un proveedor

1. Registrar finalidad, datos, región, ambiente, secreto y estrategia de salida aquí.
2. Revisar contrato y condiciones de tratamiento de datos.
3. Actualizar `legalFacts.providerDisclosure` y publicar una nueva versión del Aviso.
4. Credenciales solo en variables de entorno; nunca en el repositorio.
5. Mantener un estado explícito "no configurado" y un camino manual.
