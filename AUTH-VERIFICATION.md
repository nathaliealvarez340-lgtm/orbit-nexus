# ORBIT NEXUS — verificación de autenticación

Fecha: 23 de septiembre de 2026. Base del trabajo: `2000ad1`. Correcciones presentes en el working tree, sin stage, commit, push ni deployment. Landing pública intacta.

Actualización posterior: la sustitución autorizada de la base legacy de Neon ya terminó. Las dos migraciones actuales están aplicadas y la autenticación pasó también contra Neon real desde un servidor local. Ver [NEON-REPLACEMENT-REPORT.md](./NEON-REPLACEMENT-REPORT.md). Los procedimientos genéricos de migración descritos abajo no deben repetirse como una nueva limpieza.

## Código

Better Auth real, Prisma y las tablas User/Account/Session/Organization/Membership ya existían. Esta corrección conserva esa arquitectura y añade:

- Continuación de registro/login en `/api/auth/continue`: verifica la sesión en servidor y resuelve membresías. Sin organización, onboarding; una organización, dashboard; varias sin selección válida, elección explícita. No acepta destinos libres de redirección.
- Bloqueo de envíos duplicados durante la navegación de registro/login y creación de organización.
- Origen de autenticación y comprobaciones CSRF compartidos. Producción exige configuración explícita; Vercel rechaza localhost. Rechaza HTTP público, comodines, credenciales, rutas, queries y fragmentos en el origen. No deduce confianza de Host ni X-Forwarded-Host.
- Logout conserva las cabeceras originales de Better Auth y añade la eliminación de `orbit.organization`. Evita la combinación de cookies de Next.js 16.3.5 que pierde `Max-Age=0`. Se comprueba la eliminación de todas las cookies Better Auth, la eliminación de la sesión persistida y el rechazo de su token anterior.
- Diagnóstico de errores de configuración mediante códigos conocidos, sin registrar valores secretos.
- `npm run check:auth-env`: comprobación de formato de las tres variables obligatorias. No prueba conectividad ni aplica migraciones.

Sesiones de siete días, actualización diaria, consulta de sesión en servidor sin cookie cache. Cookies HttpOnly, SameSite=Lax y Secure en producción; sin tokens en localStorage. La cookie de organización es una preferencia: la autorización depende de la membresía consultada en la base.

## Verificaciones

| Comando / verificación | Resultado |
| --- | --- |
| `npm run lint` | Correcto |
| `npm run typecheck` | Correcto |
| `npm test` | 15 pruebas correctas |
| `npm run build` | Correcto, Next.js 16.3.5 |
| `npm run test:auth:e2e` | 14 comprobaciones correctas, cero errores de navegador |
| `npm run test:e2e` | 20 comprobaciones correctas, cero errores de navegador |
| `node scripts/verify-schema.mjs` | Sin diferencias entre las migraciones y el schema |
| Prisma CLI: deploy, segundo deploy, status y diff en base vacía aislada | Dos migraciones aplicadas; segunda ejecución sin pendientes; schema correcto |
| `git diff --check` | Sin errores de whitespace |

Los scripts E2E habituales usan Chrome, `next start`, NODE_ENV=production y PostgreSQL embebido PGlite efímero. Ejecutan Better Auth y Prisma reales. Además, se reutilizó la suite de autenticación en una ejecución controlada contra Neon main, con destino verificado y eliminación de sus cuentas y organizaciones temporales al terminar: 14 comprobaciones correctas.

Cobertura de autenticación: registro persistido, contraseña almacenada como hash, confirmación de contraseña, duplicados, credenciales inválidas, login sin/una/varias organizaciones, OWNER, refresh, sesión restaurada, expiración, logout, replay de token revocado, acceso anónimo, selección y cookie de tenant falsificadas, acceso cruzado a recursos, CSRF y cabeceras de proxy falsificadas. La suite general verifica también rutas privadas, roles, captura/revisión/gastos, CFDI, fiscal, cookies, cámara emulada y cinco tamaños de pantalla.

Evidencia local ignorada por Git: `test-results/auth-e2e-summary.json`, `test-results/e2e-summary.json`, `test-results/migration-deploy-summary.json`.

## Vercel y Neon

El responsable confirmó que Neon ya existe y está conectado mediante la integración oficial, y que las tres variables están configuradas para Production. No se generaron, modificaron ni solicitaron sus valores.

| Variable | Requisito |
| --- | --- |
| `DATABASE_URL` | Obligatoria. URL PostgreSQL suministrada por Neon, conservando sus parámetros TLS. En runtime la lee `src/lib/db.ts` mediante PrismaPg / pg, con pool máximo de cinco conexiones por instancia. No requiere cambiar de adapter para usar Neon. |
| `BETTER_AUTH_URL` | Obligatoria. `https://orbitne.com`, sin `/api/auth`. Es el origen permitido para Better Auth y operaciones privadas. |
| `BETTER_AUTH_SECRET` | Obligatoria. Secreto aleatorio estable de al menos 32 caracteres, ya configurado como Secret. No regenerarlo en cada deployment. |
| `MAIL_API_URL`, `MAIL_API_TOKEN` | Opcionales para registro/login; necesarios para recuperación de contraseña mediante el adaptador de correo. |

Ninguna credencial usa NEXT_PUBLIC_. `.env*` y `.vercel` están ignorados; solo `.env.example` está versionado y contiene placeholders. Las variables de Production deben pertenecer al proyecto que sirve `orbitne.com`. Si se usa www, redirigirlo al dominio canónico; no ampliar trustedOrigins con comodines.

La consulta pública de solo lectura del 23/09/2026 a las 14:13 UTC obtuvo `/login` y `/register` 200, `/api/auth/ok` y `/api/auth/get-session` 503, y `/dashboard` anónimo 307 hacia `/login`. Las variables nuevas no cambian deployments ya existentes: requieren un nuevo deployment. No se ha comprobado todavía su funcionamiento en el proceso de producción. [Documentación de Vercel](https://vercel.com/docs/environment-variables).

La inspección anterior del JavaScript servido encontró el formulario de autenticación real, sin el mensaje de demo. No hay evidencia suficiente para identificar el ID/SHA exacto del deployment público desde HTTP; el acceso disponible a Vercel no permitió leer sus metadatos. El mensaje demo sí existe en el commit histórico `72a9645`. No debe atribuirse automáticamente el 503 actual a ese commit.

## Migraciones y procedimiento seguro

Esta corrección de autenticación no necesita una migración nueva. El historial que debe tener producción es:

1. `202609200001_phase1`: esquema original.
2. `202609200002_multitenant`: Organization, Membership, Account, Session, Verification, límites, documentos, gastos y relaciones por organización.

Los SQL no borran tablas, columnas ni registros. La segunda migración sustituye índices/constraints y añade campos obligatorios después de rellenarlos: transforma el esquema y puede bloquear tablas durante su ejecución. Conserva registros del esquema local de fase 1, crea una organización y OWNER por usuario, y aísla los logs sin usuario. Ese procedimiento no convierte la arquitectura legacy de abril/mayo. Tras la autorización posterior para eliminar aquella arquitectura respaldada, ambas migraciones actuales se aplicaron a Neon limpio y el schema quedó sincronizado.

Antes de aplicar:

1. Verificar el proyecto, branch y base de Neon destinados a Production. Tener backup/punto de recuperación y ensayar en una copia si hay datos. No asumir que crear la integración ya creó las tablas de ORBIT.
2. Usar la versión del repositorio: `npm ci` instala Prisma 7.10 y genera el cliente; no usar una versión `latest` distinta.
3. En un terminal o job controlado, inyectar la conexión **directa** de la misma base de Neon en la variable de proceso `DATABASE_URL`, conservando TLS. Para runtime puede mantenerse la URL con pool. Este repositorio lee `DATABASE_URL` tanto en runtime como en `prisma.config.ts`; no lee automáticamente `DATABASE_URL_UNPOOLED` ni DIRECT_URL. Si la integración proporciona la variante unpooled, mapearla solo para el proceso de migración, sin reemplazar las credenciales de Vercel ni imprimirlas. [Guía de Neon para Prisma](https://neon.com/docs/guides/prisma).
4. Inspeccionar el historial con `npx prisma migrate status`. Puede devolver código 1 si hay migraciones pendientes: leer el motivo. Confirmar en Neon las tablas existentes si el historial está ausente. Un fallo de conexión, una migración fallida o un historial divergente requieren investigación antes de continuar.

Si la base está vacía, aplicar ambas. Si la primera ya figura aplicada, aplicar solo la segunda. Si ambas figuran aplicadas, el deploy de migraciones no tiene trabajo pendiente. El comando es:

```powershell
npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'La migración falló; no continuar con el deployment.' }
npx prisma migrate status
if ($LASTEXITCODE -ne 0) { throw 'Revisar el estado de migraciones antes de desplegar.' }
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Revisar diferencias de esquema antes de desplegar.' }
```

`npm run db:migrate` equivale a `prisma migrate deploy`: aplica el SQL pendiente del repositorio; no hace reset ni genera migraciones. [Referencia de Prisma CLI v7](https://www.prisma.io/docs/cli/v7/migrate).

Caso especial: si hay tablas originales de fase 1 pero no historial Prisma, comparar primero con `prisma/phase1.prisma`. Solo después de comprobar que ese baseline ya existe completo, registrar `npx prisma migrate resolve --applied 202609200001_phase1` y ejecutar el procedimiento anterior. No marcar migraciones como aplicadas en una base vacía ni para ocultar un error. Si las tablas ya son multitenant sin historial, reconciliar el esquema y el historial antes de aplicar; no ejecutar ciegamente la creación inicial.

Los hashes de usuarios heredados se conservan, pero no se convierten automáticamente a cuentas Better Auth. Si existen esos usuarios, requieren recuperación de contraseña mediante correo configurado. Esto no afecta registros nuevos en una base vacía.

## Antes y después del deployment

El código está preparado para commit y la comprobación/migración de Neon ya terminó. El responsable puede publicar **el commit que incluya estas correcciones**, generar un deployment nuevo con las variables de Production y confirmar que `orbitne.com` apunta a ese deployment. No basta con volver a publicar el commit histórico de demo. La última consulta pública aún devuelve 503 en autenticación; la comprobación sobre el dominio queda pendiente del deployment.

Mantener preset Next.js, instalación `npm ci` y build `npm run build`. Puede usarse `npm run check:auth-env && npm run build` para rechazar configuración ausente o inválida antes de publicar. El check no reemplaza migrate status ni la prueba real de conexión.

Después: `/api/auth/ok` debe responder 200; `/api/auth/get-session` sin sesión, 200 con ausencia de sesión. Comprobar registro, organización OWNER, dashboard, refresh, logout y login con una cuenta de QA autorizada en el dominio HTTPS. `/api/auth/ok` por sí solo no prueba consultas a Neon. Si persiste el 503, revisar logs y estado de migraciones sin compartir credenciales.

Autenticación no tiene mocks operativos. Siguen pendientes externos ajenos a esta corrección: correo de recuperación, OCR, PAC/SAT y automatización de portales. La cámara se verifica emulada; pruebas físicas/Safari/iOS siguen siendo validación de dispositivos. La autenticación de producción no se declara resuelta hasta pasar la comprobación posterior al deployment.
