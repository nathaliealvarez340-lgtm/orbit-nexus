# ORBIT NEXUS — reporte de cierre de fase 2

Verificación local: 22 de septiembre de 2026, America/Mexico_City. Trabajo conservado en el working tree, sin staging, commit ni push. No se reinició la implementación, no se descartaron cambios ni se ejecutaron reset/restore/checkout. La landing, root layout, estilos globales, componentes de marketing/marca y assets públicos no presentan diferencias respecto a HEAD.

## 1. Estado recuperado y trabajo completado

Al retomar esta continuación ya estaban presentes la actualización a Next.js 16.3.5, modelo Organization/Membership, autenticación y selección de organización, aislamiento tenant-aware, migraciones, dashboard con gastos reales, flujo básico captura/revisión/Expense, perfil fiscal y facturación asistida. Las primeras pruebas de captura y aislamiento habían pasado; faltaban cerrar casos de archivos/XML, cámara, responsive y la validación final.

Esta continuación terminó:

- Respuesta 413 para archivos mayores de 10 MB y límites separados para multipart XML+PDF. Validación correlacionada de MIME/extensión en cliente, firma/tamaño en servidor, rechazo de vacíos y tipos no permitidos.
- Parser compartido para CFDI y extracción fiscal que resuelve namespaces heredados/locales, rechaza duplicados/DTD/entidades y valida versión, UUID, RFC, fecha e importes. UUID normalizado y fecha compatible con/sin sufijo Z.
- Incorporación confirmada de XML y PDF opcional, guardado privado, validación contra RFC receptor y total del gasto, protección de duplicados y actualizaciones/auditoría transaccionales. El estado nunca cambia por abrir un portal.
- Referencias de facturación editables tras registrar el gasto, con autorización tenant-aware, auditoría y bloqueo después de incorporar factura; no modifica importe/fecha del Expense.
- Cámara con liberación de tracks al capturar/cerrar, protección de aperturas simultáneas y fallback por permiso denegado/ausencia de API. Validación de subida en móvil.
- Ajuste de etiquetas de la gráfica para pantallas pequeñas. Corrección/documentación de navegación: recarga completa justificada al cambiar sesión/tenant y al invalidar datos precargados; no quedan advertencias de lint.
- Revisión de rutas privadas, headers sin caché compartida, recuperación por correo con estado explícito si no está configurada, calculadora de timbrado sin datos de ejemplo ni botón inerte.
- Versiones alineadas de Prisma 7.10 y overrides acotados de dependencias del CLI; auditoría de dependencias sin vulnerabilidades reportadas.
- Documentación de configuración, migración no destructiva, contratos de adaptadores, pruebas y límites de despliegue.

## 2. Funcionalidad actual verificada

Registro/login/logout; creación y selección de organizaciones; sesiones en servidor con cookies HttpOnly/SameSite=Lax/Secure en producción; autorización por membresía.

Dashboard autenticado con gasto del mes, gasto del año seleccionado, tickets capturados, pendientes, facturados y facturas obtenidas; gráfica de doce meses desde Expense confirmado, filtro anual, actividad y tickets recientes. No usa fixtures para métricas.

Captura flotante, foto o JPG/JPEG/PNG/WEBP/PDF; análisis separado; revisión editable; Expense creado únicamente al confirmar, una vez por ticket. Capturado → Analizando → Datos detectados → Revisión → Confirmado/Registrado. Los últimos dos pasos se persisten atómicamente.

Historial de tickets con búsqueda/paginación, detalle y original privado; historial de facturas con XML/PDF; perfil/documentos fiscales por organización; roles OWNER/ADMIN para modificaciones fiscales; facturación asistida OXXO/Walmart/Costco; ActivityLog.

Cookies necesarias/analíticas/marketing, aceptar todas, rechazar no esenciales, configurar y cambiar preferencias. No hay trackers opcionales activos. Rutas `/privacy`, `/cookies`, `/terms` preparadas con límites y revisión del operador explícitos.

## 3. Validaciones y resultados

| Verificación | Resultado |
|---|---|
| `npm run lint` | PASS, 0 errores y 0 advertencias |
| `npm run typecheck` | PASS, salida 0 |
| `npm test` | PASS, 11 tests, 0 fallos/omitidos |
| `npm run build` | PASS, Next.js 16.3.5; TypeScript y generación de rutas completados |
| `npm run test:e2e` | PASS, 20 grupos de comprobaciones; 0 errores JavaScript |
| `node scripts/verify-schema.mjs` | PASS, Prisma: No difference detected |
| `npm audit` | 0 vulnerabilidades reportadas |
| `git diff --check` | Sin errores |
| Revisión de secretos / env | Sin secretos reales detectados; solo placeholders/credenciales sintéticas locales |
| Landing y assets | Diff vacío en rutas protegidas de cambios |

Las E2E ejecutaron Next en producción con Chrome headless y una base PGlite efímera. Se verificó UI → API → persistencia, evitando bases externas. Incluyen:

1. Redirección anónima, registro, OWNER y cookies de sesión seguras.
2. Captura, análisis manual explícito, revisión, confirmación idempotente y navegación a métricas actualizadas.
3. Accesos cruzados a tickets, documentos, OCR, confirmación, facturación, workspace y CSRF rechazados.
4. Archivos reales de los cinco formatos, MIME/firma/extensión inconsistentes, vacíos, SVG/ejecutables y exceso de tamaño. Tenant enviado en multipart no concede acceso.
5. Referencias de factura editables sin alterar el gasto; perfil fiscal requiere confirmación; MEMBER no puede modificarlo ni subir documentos fiscales.
6. XML con namespace, UUID, RFC, total, fecha, timbre, entidades o consentimiento inválidos rechazado sin efectos; CFDI válido con PDF incorporado; UUID duplicado y edición posterior bloqueados; archivos ajenos inaccesibles.
7. Extracción fiscal seguida de confirmación explícita y conservación del audit log.
8. Gráfica y filtro anual calculados según fecha/importe de gastos confirmados.
9. Dashboard desktop 1440×1000, laptop 1280×800, tablet 820×1180, móvil 390×844 y móvil pequeño 360×740. Sin overflow horizontal del documento. Principales páginas privadas/políticas también revisadas a 360 px; tablas con scroll local.
10. Cámara emulada con frames, captura, repetición y liberación de tracks; permiso denegado, API ausente y upload móvil; modal abre/cierra y funciona con Escape.
11. Preferencias de cookies independientes conservando autenticación; cambio de workspace sin datos anteriores; páginas de otro tenant no muestran sus datos.
12. Logout revoca todas las páginas/operaciones privadas probadas, login vuelve a funcionar y auditarse, recuperación sin proveedor devuelve indisponibilidad explícita y login repetido se limita con 429.

Evidencia local: `test-results/e2e-summary.json` y capturas `test-results/dashboard-*.png`, `test-results/capture-mobile.png`. Estos artefactos están ignorados por Git. Las fechas E2E se ajustan al calendario actual. La cámara física y Safari/iOS no se han probado; la emulación no sustituye pruebas en hardware.

## 4. Archivos principales

- Modelo y migraciones: `prisma/schema.prisma`, `prisma/phase1.prisma`, `prisma/migrations/*`.
- Sesión y autorización: `src/lib/auth.ts`, `tenant.ts`, `http.ts`, `validation.ts`.
- Documentos/CFDI: `src/lib/upload-validation.ts`, `cfdi.ts`, rutas `src/app/api/documents` y servicios `fiscal.ts`, `invoices.ts`.
- Dominio: `src/services/tickets.ts`, `dashboard.ts`, `ocr/adapter.ts`, `invoice-provider/assisted.ts`.
- UI: `src/app/dashboard/*`, `src/components/dashboard/*`, formularios `ticket-review`, `assisted-invoice`, `invoice-import`, `fiscal-form`, `auth-form`, cookies y páginas legales.
- Verificación: `tests/security.test.ts`, `tests/contracts.test.ts`, `scripts/e2e.mjs`, `scripts/verify-schema.mjs`.
- Configuración/documentación: `package.json`, lockfile, `next.config.ts`, `.env.example`, `.gitignore`, `README.md`, `ARCHITECTURE.md`.

## 5. Migraciones y variables necesarias

Migraciones preparadas y comprobadas en base aislada:

- `202609200001_phase1`: baseline del esquema previo.
- `202609200002_multitenant`: organizaciones/membresías, autenticación, documentos/gastos, backfill no destructivo y relaciones compuestas por tenant.

Base nueva: `npm run db:migrate`. Base fase 1 existente: backup y comparación con `prisma/phase1.prisma`; solo si coincide y ya contiene ese esquema, `npx prisma migrate resolve --applied 202609200001_phase1`, luego `npm run db:migrate`. No se aplicaron migraciones a una base externa. Ensayar staging con la versión real de PostgreSQL antes de producción. Los hashes antiguos se conservan y requieren recuperación por correo; documentos antiguos solo con storageKey necesitan importar sus bytes desde el almacenamiento original.

Obligatorias: `DATABASE_URL`, `BETTER_AUTH_URL` (origen exacto), `BETTER_AUTH_SECRET` (aleatorio, estable y mínimo 32 caracteres).

Opcionales: `OCR_API_URL`, `OCR_API_TOKEN`, `MAIL_API_URL`, `MAIL_API_TOKEN`. Sin OCR, revisión manual; sin correo, recuperación explícitamente no disponible. No hay claves públicas ni tokens sensibles en localStorage. `.env`, `.env.local`, `.env.production` están ignorados; `.env.example` contiene placeholders sin secretos.

## 6. Integraciones, mocks y límites reales

- OCR: adapter HTTP funcional con contrato validado; ningún proveedor real configurado. Fallback manual vacío explícito, sin datos OCR inventados. Extracción de constancias PDF/imagen pendiente; lectura estructural de CFDI XML sí implementada.
- PAC: no conectado. Timbrado es calculadora local sin persistencia ni emisión. Se eliminó su ejemplo monetario inicial y el botón sin efecto; no se presenta como emisor real.
- SAT: la importación valida estructura y coherencia, no firma criptográfica/autenticidad/vigencia. `ISSUED` es el enum legado usado para CFDI incorporado; la interfaz declara la validación externa pendiente. El PDF se almacena como adjunto, no se coteja semánticamente con el XML.
- Portales: redirección asistida a URLs curadas; automatización y recuperación automática de CFDI no conectadas. No hay emisión simulada, scraping ni evasión de CAPTCHA.
- Correo: requiere un servicio real para recuperación. No se enviaron mensajes reales.
- Los archivos antiguos `src/data/mock/*` y `mock-provider.ts` permanecen como referencia, sin importaciones en los flujos privados. Las cifras del dashboard, tickets, gastos y facturas son reales de la base activa.
- Operación de producción: configurar HTTPS, PostgreSQL, backups/cifrado, cuotas/retención, limpieza de límites vencidos y observabilidad sin datos sensibles. Los uploads privados en DB funcionan, pero para volumen alto hacen falta almacenamiento dedicado y análisis antimalware. La plataforma/proxy debe aceptar los límites multipart indicados; límites menores requieren upload privado directo y validación posterior.
- Gestión de invitaciones/miembros no tiene UI en esta fase; roles y autorización están implementados y probados. Las políticas requieren datos del responsable y revisión previa a publicación.

No queda un bloqueo de compilación/pruebas local. Las conexiones externas y la validación de dispositivos/producción son pendientes explícitos y no se simularon para declarar éxito.

## 7. Estado Git final

`git status --porcelain=v1 -uall`: 32 archivos rastreados modificados, 57 archivos nuevos sin seguimiento (incluido este reporte), 0 staged, 0 eliminados. El working tree conserva la implementación completa y documentación para revisión. Sin `git add`, commit ni push. `git diff --check` limpio; la landing tiene diff vacío.
