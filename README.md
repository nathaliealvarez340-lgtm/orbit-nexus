# ORBIT NEXUS — fase 2

Aplicación Next.js 16.3.5 / React 19 / Prisma 7.10 / PostgreSQL. La landing pública se conserva. El dashboard usa datos persistidos de la organización autorizada, sin fixtures de demostración.

Corrección de autenticación, pruebas y procedimiento de publicación con Neon: [AUTH-VERIFICATION.md](./AUTH-VERIFICATION.md).

## Arranque

Requiere Node.js 22.12+ (verificado con 24.14.1), npm y PostgreSQL para despliegues reales.

1. `npm ci` (genera el cliente Prisma).
2. Copiar `.env.example` a `.env`. Configurar `DATABASE_URL`, `BETTER_AUTH_URL` con el origen exacto y `BETTER_AUTH_SECRET` aleatorio de al menos 32 caracteres. Mantener el secreto estable entre instancias/reinicios.
3. Aplicar las migraciones según la sección siguiente.
4. `npm run dev` o `npm run build` y `npm start`. En producción, usar HTTPS.

Para probar sin instalar PostgreSQL: `npm run dev:local`, abrir http://localhost:3100. Usa PostgreSQL embebido PGlite, ligado solo a loopback, persistente en `.orbit-local/postgres` (ignorado por Git). Crea su propia base y aplica migraciones; no usa ni altera `DATABASE_URL`. El secreto de desarrollo cambia al reiniciar: volver a iniciar sesión. Este modo no sirve para producción ni datos sensibles compartidos; otras aplicaciones locales pueden acceder al socket. `PORT` permite elegir otro puerto.

En equipos Windows con CA corporativa, `NODE_USE_SYSTEM_CA=1` permite usar el almacén de certificados del sistema sin desactivar la validación TLS. La compilación conserva `next/font` y necesita acceso a Google Fonts.

## Migraciones

- `202609200001_phase1`: esquema original conservado como baseline.
- `202609200002_multitenant`: organizaciones, membresías, sesiones, cuentas, documentos privados, gastos y límites de solicitudes; adapta las relaciones existentes a claves compuestas por organización.

Base nueva: `npm run db:migrate` ejecuta ambas. Base existente de fase 1: hacer backup, verificar que el esquema coincide con `prisma/phase1.prisma`, registrar **solo ese baseline ya presente** con `npx prisma migrate resolve --applied 202609200001_phase1` y después `npm run db:migrate`. No marcar el baseline en una base vacía. Probar primero una copia/staging; no usar `db push`, reset ni recrear tablas.

La migración crea una organización y membresía OWNER por usuario previo, asigna sus registros y conserva los logs sin usuario en un archivo sin miembros. No convierte importes OCR antiguos en gastos. Los hashes de contraseñas anteriores se conservan pero no se adivina su algoritmo: se requiere recuperación de contraseña por el adaptador de correo para crear credenciales compatibles. Los documentos antiguos que solo tengan `storageKey` requieren una migración desde su almacenamiento original; no se inventan sus bytes.

El 23/09/2026 se aplicaron ambas migraciones a Neon después de la eliminación autorizada de la arquitectura legacy respaldada. Ver [NEON-REPLACEMENT-REPORT.md](./NEON-REPLACEMENT-REPORT.md). Los scripts de pruebas habituales siguen usando bases aisladas.

## Variables

| Variable | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL privado, con TLS según el proveedor |
| `BETTER_AUTH_URL` | Origen exacto, sin comodines; valida cookies, redirecciones y CSRF |
| `BETTER_AUTH_SECRET` | Secreto aleatorio del servidor, mínimo 32 caracteres |
| `OCR_API_URL` | Endpoint de un adaptador OCR de confianza; ausente = captura manual explícita |
| `OCR_API_TOKEN` | Token Bearer del adaptador OCR, si lo requiere |
| `MAIL_API_URL` / `MAIL_API_TOKEN` | Endpoint y token Bearer para recuperación de contraseña |

Todos se leen solo en servidor. `.env*` está ignorado excepto `.env.example`. No se guardan tokens de sesión en localStorage. No hay claves PAC activas: ningún código invoca un PAC.

## Flujos y límites

Registro/login → creación/selección de organización → captura por cámara o archivo → análisis → revisión editable → **Confirmar y registrar** → Expense → métricas mensuales. Analizar jamás crea un gasto. Confirmar es transaccional e idempotente. Los gastos y la gráfica usan la fecha de compra; el total del mes usa America/Mexico_City. Todos los importes actuales son MXN. Los cuatro contadores de tickets/facturas son históricos de la organización, etiquetados como tales.

JPG/JPEG/PNG/WEBP/PDF: hasta 10 MB, extensión, MIME y firma comprobados en servidor, tamaño y formato en cliente, petición multipart acotada. XML: hasta 1 MB, sin DTD/entidades, CFDI 4.0 y namespaces correctos. Documentos en PostgreSQL, descargados tras comprobar membresía y organización; sin URLs públicas. Cámara exige HTTPS o localhost y permisos; ante ausencia/denegación permite subir archivo.

Facturación asistida: adaptadores para portales oficiales de OXXO, Walmart y Costco, validación de datos, referencias editables y copia de datos. Abrir un portal no transmite datos automáticamente ni marca como facturado. Un XML de CFDI incorporado expresamente y validado contra RFC receptor/importe del gasto actualiza ticket/gasto/factura y ActivityLog. PDF opcional como adjunto, sin afirmar que su contenido fue cotejado con XML. El UUID se normaliza. La comprobación criptográfica y de vigencia ante SAT sigue pendiente. La pantalla de timbrado es una calculadora local explícita; no guarda ni emite un CFDI.

El perfil fiscal requiere confirmación y rol OWNER/ADMIN. XML puede proponer datos del receptor; PDF/imagen requieren revisión manual mientras no se conecte extracción fiscal. La aplicación no incluye aún invitaciones/administración de miembros; el modelo y autorización de MEMBER están cubiertos por pruebas.

Cookies: necesarias activas, analíticas y marketing independientes, aceptar/rechazar/configurar. No se cargan rastreadores. El panel está en acceso, dashboard y `/cookies`; la landing sigue intacta. `/privacy`, `/cookies` y `/terms` son textos operativos que el responsable debe completar y revisar antes del lanzamiento.

## Adaptadores externos

OCR HTTP: POST JSON `{mimeType, base64}` a `OCR_API_URL`, Bearer opcional, timeout 30 s, sin seguir redirecciones. Respuesta `{provider, confidence: 0..1 | null, fields: {...}, raw?: ...}` limitada a 1 MB. Los campos admitidos están en `src/services/ocr/adapter.ts`. Incluso un OCR real solo propone datos; la revisión humana siempre es obligatoria.

Correo HTTP: POST `{to, template: "orbit-password-reset", url}` con Bearer, timeout 10 s, sin redirecciones. El servicio debe enviar el enlace sin registrarlo en logs. Sin ambos valores configurados, recuperación responde explícitamente no disponible. No se enviaron correos reales en pruebas.

Pendientes externos: proveedor OCR y extracción fiscal, PAC, validación SAT, automatización autorizada de portales y correo transaccional. No se automatiza CAPTCHA ni se simula emisión. Los antiguos `src/data/mock` y `mock-provider.ts` se conservan para referencia, sin importaciones en las rutas operativas.

## Verificación

- `npm run validate`: security check, lint, typecheck, tests y build. Prevención y configuración manual de GitHub: [SECURITY.md](./SECURITY.md).
- `npm run security:check`: revisa índice Git y archivos locales sin imprimir secretos; también se ejecuta antes de `check:auth-env`.
- `npm run lint`
- `npm run typecheck` (tras `npm ci`; build genera también tipos de rutas)
- `npm run check:auth-env`: valida el formato de las variables de autenticación, sin mostrar valores ni conectar a la base.
- `npm test`: validación, contratos y migración con datos heredados en PGlite.
- `npm run build`
- `npm run test:e2e`: exige un build previo y Chrome instalado. Arranca Next en producción y una base PGlite efímera, crea usuarios sintéticos y cierra ambos al finalizar. `ORBIT_TEST_PORT` cambia el puerto 3197. No accede a bases de producción ni a OCR/correo reales.
- `npm run test:auth:e2e`: prueba registro/login reales, cookies, logout, expiración, workspaces y aislamiento con el mismo enfoque aislado. `ORBIT_AUTH_TEST_PORT` cambia el puerto 3198.
- `npm audit`: los overrides acotados de deepmerge-ts y mysql2 corrigen dependencias del CLI Prisma; generación, build y pruebas se verifican con esas versiones.

E2E cubre UI/API/base de datos, dos tenants, roles, archivos, CFDI, importes, cookies, login/logout, cámara **emulada** y tamaños desktop/laptop/tablet/mobile. Capturas y resumen quedan en `test-results` (ignorado). Cámara física, Safari/iOS y proveedores externos requieren validación en dispositivos/servicios reales.

## Operación pendiente antes de producción

Configurar HTTPS, base con copias de seguridad/cifrado y sus credenciales, cuotas/retención de documentos y limpieza periódica de límites expirados, observabilidad sin datos personales, recuperación por correo y procedimientos de soporte. El almacenamiento en DB es funcional pero conviene mover grandes volúmenes a almacenamiento privado con análisis antimalware. Los límites del proxy/plataforma deben permitir multipart de 10 MB (11 MB para XML+PDF); plataformas con límites menores necesitan upload privado directo con validación posterior. Migraciones probadas en PGlite deben ensayarse también contra la versión de PostgreSQL del despliegue.

También puede ejecutarse `node scripts/verify-schema.mjs`: aplica las migraciones en una base aislada y compara el resultado con `prisma/schema.prisma` usando `prisma migrate diff --exit-code`. No escribe en la base configurada del despliegue.
