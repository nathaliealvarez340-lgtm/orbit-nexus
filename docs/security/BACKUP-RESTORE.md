# ORBIT NEXUS — Respaldo y restauración

Procedimiento para el operador. **Esta fase no ejecutó ningún respaldo ni restauración
productiva.** Un agente de código no opera Neon sin instrucción explícita.

## 1. Qué respaldar

| Elemento | Dónde vive | Cómo se protege |
|---|---|---|
| Base de datos completa, incluidos los documentos privados (`Document.content`) | Neon | Snapshots/branches de Neon y restauración a un punto en el tiempo según el plan contratado (verificar ventana) |
| Esquema y migraciones | Repositorio (`prisma/migrations`) | Git |
| Recursos SAT versionados | Repositorio (`resources/sat`, `src/lib/sat/catcfdi`) | Git + hashes en `manifest.json` |
| Configuración de despliegue | Variables de entorno de Vercel | Inventario de **nombres** (no valores) en `.env.example`; los valores viven en el gestor de secretos del operador |
| Secretos | Gestor de secretos del operador | Nunca en respaldos de base de datos ni en el repositorio |

Los secretos (`BETTER_AUTH_SECRET`, `DATABASE_URL`, tokens) no forman parte del respaldo de
datos: perderlos obliga a rotarlos, no a restaurarlos.

## 2. Antes de cada migración productiva

1. Autorización explícita del responsable y migración revisada (aditiva cuando sea posible).
2. Crear un snapshot o branch de Neon con nombre descriptivo y fecha
   (por ejemplo `orbit-before-<migracion>-<AAAA-MM-DD>`), como el snapshot previo a la
   sustitución de la base legacy.
3. Verificar que el snapshot existe y anotar su identificador en el registro del cambio.
4. Probar la migración primero en PGlite local (`node scripts/verify-schema.mjs`) y, si es
   posible, en un branch de Neon.
5. Aplicar con `npm run db:migrate` (`prisma migrate deploy`). Nunca `migrate reset` ni
   `db push`.
6. Verificar la aplicación (smoke tests) y conservar el snapshot hasta confirmar estabilidad.

Migración pendiente de esta fase: `202610090001_phase5c2_legal_security` (aditiva). No se ha
aplicado en Neon.

## 3. Cifrado

- En tránsito: conexiones a Neon con TLS (`sslmode`), aplicación por HTTPS.
- En reposo en Neon: confirmar las garantías del plan contratado; no se asumen.
- Exportaciones fuera de Neon (`pg_dump`): cifrar el archivo antes de moverlo (por ejemplo, con
  una herramienta de cifrado de archivos con llave del operador) y nunca guardarlo en el
  repositorio. `.gitignore` y `npm run security:check` bloquean dumps y respaldos.

## 4. Acceso

- Solo el operador y personas designadas acceden a la consola de Neon y a los snapshots.
- MFA obligatorio en Neon, Vercel y GitHub (verificar).
- Restaurar o descargar un respaldo es un acceso a datos FISCAL_SENSITIVE: registrar quién,
  cuándo y por qué.

## 5. Retención de respaldos

Por definir con revisión legal (`DATA-RETENTION.md`). Debe considerar que los datos eliminados
por solicitud permanecen en respaldos hasta su expiración.

## 6. Restauración

Elegir según el caso:

- **Error lógico reciente** (por ejemplo, borrado accidental): restaurar a un punto en el tiempo
  en un **branch nuevo** de Neon, verificar los datos y luego decidir si se promueve el branch o
  se copian solo los registros afectados.
- **Pérdida total**: restaurar el último snapshot en un proyecto/branch nuevo, actualizar
  `DATABASE_URL` en Vercel y redesplegar.
- **Desde `pg_dump`**: `pg_restore` en una base PostgreSQL vacía de la misma versión mayor;
  luego `prisma migrate deploy` solo si faltan migraciones posteriores al respaldo.

Después de restaurar:

1. `prisma migrate status` sin pendientes inesperados.
2. Smoke tests: inicio de sesión, dashboard, descarga de un documento, reporte.
3. Revisar que los eventos de `AuditEvent` posteriores al punto de restauración se documentan
   en el registro del incidente (se pierden en la base restaurada).
4. Invalidar sesiones si el incidente lo requiere.

## 7. Prueba de restauración

Al menos antes del lanzamiento y luego periódicamente (frecuencia por definir):

1. Restaurar el respaldo más reciente en un branch de Neon aislado (nunca sobre producción).
2. Conectar una instancia local o preview con ese branch, sin enviar correos ni llamar a
   proveedores (variables de proveedores vacías).
3. Ejecutar los smoke tests del §6.
4. Medir el tiempo total y comparar con los objetivos de recuperación (RTO/RPO por definir).
5. Eliminar el branch de prueba y registrar el resultado.
