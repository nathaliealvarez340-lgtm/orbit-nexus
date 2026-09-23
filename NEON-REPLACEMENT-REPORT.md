# ORBIT NEXUS — sustitución de la base legacy

Fecha: 23 de septiembre de 2026. Operación expresamente autorizada por el responsable después de crear el snapshot `orbit-legacy-before-reset-2026-09-23`.

## Destino y respaldo

- Proyecto Neon: `orbit-nexus-db` (`dry-king-05423415`).
- Branch: `main` (`br-super-union-amcbnf2s`).
- Endpoint verificado en la consola: `ep-falling-river-amjnkbpk`.
- Database/schema: `neondb` / `public`; role: `neondb_owner`.
- La conexión local coincidió con ese endpoint y la identidad devuelta por PostgreSQL.
- Snapshot verificado antes y después: `orbit-legacy-before-reset-2026-09-23`, 34.64 MB, expiración `never`. No se modificó.

No se alteraron proyecto, branch, otras bases, roles, credenciales, permisos del schema ni extensiones de PostgreSQL. No se imprimió la conexión completa ni passwords. La conexión y los secretos existentes permanecen intactos.

## Operación realizada

La base tenía 47 tablas, 138 índices y 44 enums de la arquitectura legacy, con diez migraciones de abril/mayo. No tenía vistas, materialized views, secuencias ni funciones en public, ni dependencias desde otros schemas de aplicación.

Se eliminaron las 47 tablas, incluidos sus datos, constraints, índices y el historial `_prisma_migrations`, y los 44 enums legacy. La eliminación se hizo en una transacción con comprobación exacta de destino, inventario e historial, bloqueo de las tablas y `DROP ... RESTRICT`. No se usó CASCADE para alcanzar objetos fuera del conjunto autorizado. Se conservó el schema public con su propietario `pg_database_owner` y sus permisos.

Antes de confirmar la limpieza se comprobó que public no contenía relaciones, tipos ni funciones de aplicación. Después se ejecutó exclusivamente `npm run db:migrate` (`prisma migrate deploy`) con los dos SQL existentes, sin modificarlos ni añadir migraciones:

1. `202609200001_phase1`
2. `202609200002_multitenant`

No se restauró el historial legacy, no se hizo baseline y no se usó migrate resolve, migrate reset ni db push.

## Resultado en Neon

`npx prisma migrate status`: **Database schema is up to date!**

`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: **No difference detected**, salida 0.

Hay exactamente 20 tablas de aplicación y `_prisma_migrations`. Principales: User, Account, Session, Verification, Organization, Membership, Document, Expense, Ticket, Invoice, FiscalProfile y ActivityLog. Se verificaron 28 foreign keys, 21 claves primarias y 55 índices. Los seis enums coinciden con la arquitectura actual.

El historial contiene exclusivamente las dos migraciones actuales, ambas completas y con checksums idénticos a los SQL locales. No quedan tablas legacy.

## Autenticación real contra Neon

Se reutilizó `scripts/auth-e2e.mjs` mediante un ejecutor temporal ignorado por Git: servidor Next local en modo producción y la conexión verificada a Neon main. Se usaron un origen y secreto efímeros exclusivamente para ese proceso de QA; no se cambiaron variables persistentes, credenciales de Neon ni configuración de Vercel.

Pasaron 14 comprobaciones: registro real y hash de contraseña, duplicados, credenciales inválidas, login sin/una/varias organizaciones, sesión y refresh, Organization/OWNER/Membership, selección segura de workspace, aislamiento, rechazo de origen no autorizado, expiración, logout y rechazo del token revocado. Cero errores de navegador.

Al finalizar se eliminaron por sus identificadores las dos cuentas y tres organizaciones temporales. Se verificó que User, Account, Session, Organization, Membership, Ticket, Document, Expense, Invoice y ActivityLog quedaron sin registros de QA. Permanecen únicamente seis contadores operativos temporales en RateLimit/RequestLimit, además de las dos entradas del historial de migraciones; no contienen datos legacy.

## Validaciones locales

- `npm run lint`: correcto.
- `npm run typecheck`: correcto.
- `npm test`: 15/15.
- `npm run build`: correcto, Next.js 16.3.5.
- `npm run test:auth:e2e`: 14/14 en base aislada, además de 14/14 en Neon.
- `npm run test:e2e`: 20/20; incluye privacidad de tenant, uploads/CFDI, cookies, cámara emulada y responsive.
- `git diff --check`: sin errores.

Evidencia ignorada por Git: `test-results/neon-preflight.json`, `neon-legacy-replacement.json`, `neon-final-schema.json`, `neon-auth-e2e-summary.json`, `neon-auth-qa-cleanup.json` y `neon-final-data-counts.json`.

## Publicación pendiente

No se hizo stage, commit, push ni deployment/redeploy. La landing y las migraciones existentes no se modificaron. `.env` permanece ignorado; `.env.example` contiene placeholders, sin credenciales reales. No se encontraron secretos actuales en los cambios revisados y el índice Git está vacío de cambios.

La consulta pública del 23/09/2026 a las 20:20 UTC aún devolvió 503 en `/api/auth/ok` y `/api/auth/get-session`; `/dashboard` anónimo redirige a `/login`. Esta respuesta corresponde al deployment existente, no al servidor local validado contra Neon.

Después de revisar el trabajo, el responsable puede hacer commit/push y publicar un deployment nuevo. Comprobar que Production use la conexión vigente tras la rotación y `BETTER_AUTH_URL=https://orbitne.com`, conservando BETTER_AUTH_SECRET estable. No hace falta repetir la limpieza ni crear nuevas migraciones. Tras desplegar, verificar el flujo de registro/login/logout en el dominio HTTPS.

El correo de recuperación, OCR, PAC/SAT y la automatización de portales siguen dependiendo de integraciones externas. Esta operación no los simuló ni los configuró.
