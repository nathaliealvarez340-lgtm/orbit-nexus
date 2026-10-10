# ORBIT NEXUS — Respuesta a incidentes

Guía operativa. Los plazos y obligaciones de notificación a titulares y autoridades dependen de
la legislación aplicable y deben definirse con asesoría legal
(`docs/legal/OPEN-LEGAL-ITEMS.md` §13). No se establecen aquí.

## Roles

| Rol | Responsabilidad | Asignado |
|---|---|---|
| Responsable del incidente | Coordina, decide contención y comunicaciones | Pendiente (operador) |
| Técnico | Investiga, contiene y recupera | Pendiente |
| Legal | Evalúa obligaciones de notificación | Pendiente |

Un agente de código **no** ejecuta acciones de producción (rotar secretos, cambiar variables,
consultar Neon) sin instrucción explícita del operador.

## Flujo común

1. **Detectar**: alerta, reporte de usuario, revisión de `AuditEvent`/`ActivityLog`, logs de
   Vercel (líneas `{"level":"error",...}`), secret scanning de GitHub, alertas de proveedores.
2. **Contener**: limitar el daño sin destruir evidencia.
3. **Investigar**: alcance (Organizations, usuarios, datos, periodo), causa raíz.
4. **Rotar / revocar**: credenciales, sesiones, tokens afectados.
5. **Notificar / escalar**: decisión documentada del responsable con asesoría legal.
6. **Recuperar**: corregir, restaurar si hace falta (`BACKUP-RESTORE.md`), verificar.
7. **Postmortem**: cronología, causa, impacto, acciones preventivas, sin culpas.

Evidencia: antes de modificar datos, crear un branch o snapshot de Neon para análisis forense.
`AuditEvent` es append-only; no deshabilitar su trigger durante un incidente.

Consultas útiles (en un branch de análisis, nunca exportando datos fuera del entorno seguro):

- Acciones sensibles de una Organization: `SELECT action, result, "actorUserId", "targetType",
  "targetId", "createdAt" FROM "AuditEvent" WHERE "organizationId" = $1 ORDER BY "createdAt"`.
- Accesos denegados: `... WHERE result = 'DENIED'`.
- Sesiones de un usuario: `SELECT id, "createdAt", "expiresAt", "ipAddress", "userAgent" FROM
  "Session" WHERE "userId" = $1`.

## Escenarios

### 1. Fuga entre tenants (Organization A ve datos de B)

- Detectar: reporte de usuario, test E2E de aislamiento fallando, ruta nueva sin `requireTenant`.
- Contener: desactivar la ruta afectada (despliegue con la ruta deshabilitada o rollback en
  Vercel al despliegue anterior).
- Investigar: identificar la consulta sin filtro `organizationId`; cruzar logs de acceso,
  `AuditEvent` y `ActivityLog` para saber qué Organizations y registros se expusieron.
- Rotar/revocar: si se expusieron documentos con tokens o enlaces, invalidarlos.
- Notificar: Organizations afectadas, según decisión legal.
- Recuperar: corrección con test E2E de regresión; revisar rutas similares.
- Postmortem: por qué la revisión y los tests no lo detectaron.

### 2. Exposición de sesión o token

- Detectar: sesiones desde IP/agente inusual, reporte del usuario, token en un log o ticket.
- Contener: revocar las sesiones del usuario (borrar sus filas de `Session`; el `cookieCache`
  está deshabilitado, así que el efecto es inmediato) y forzar cambio de contraseña.
- Si se expuso `BETTER_AUTH_SECRET`: rotarlo en Vercel y redesplegar; invalidar todas las
  sesiones (borrar `Session`) y tokens de `Verification`.
- Investigar: acciones del usuario en `AuditEvent` durante la ventana de exposición.
- Recuperar: revisar cambios fiscales o de clientes hechos por la sesión comprometida.

### 3. Fuga de documento privado (CSF, CFDI, ticket)

- Detectar: documento accesible sin sesión, en otra Organization o fuera del sistema.
- Contener: corregir la ruta de descarga (`/api/documents/[id]` exige sesión y Organization);
  rollback si aplica.
- Investigar: qué documentos, de quién, desde cuándo; si salieron por un proveedor (OCR,
  worker), solicitar al proveedor su investigación.
- Notificar: titulares de los datos de los documentos, según decisión legal.
- Recuperar: verificar headers (`attachment`, `sandbox`, `no-store`) y tests.

### 4. Credenciales de PAC comprometidas (fase futura)

- Contener: revocar las credenciales en el portal del PAC; vaciar las variables en Vercel para
  que ORBIT pase a estado "no configurado".
- Investigar: timbrados no autorizados en el periodo (cuando exista `invoice.stamped`).
- Rotar: nuevas credenciales solo en variables de entorno.
- Notificar: PAC y Organizations afectadas.
- Recuperar: cancelar comprobantes no autorizados conforme al proceso fiscal (fase futura).

### 5. Compromiso de CSD (fase futura)

- Contener: bloquear el timbrado de la Organization; marcar el CSD como revocado
  (`csd.revoked`).
- Escalar: el contribuyente debe revocar el certificado ante el SAT; ORBIT no puede hacerlo.
- Investigar: comprobantes emitidos con ese CSD y quién los autorizó (`invoice.stamp_authorized`).
- Recuperar: destruir la copia custodiada y cargar el nuevo CSD.
- Diseño de custodia pendiente: este escenario se completará en la fase de CSD.

### 6. Acción fiscal no autorizada

Por ejemplo: perfil fiscal o cliente modificado, envío a un portal sin aprobación válida.

- Detectar: `fiscal_profile.updated`, `client.fiscal.updated`, eventos de billing inesperados.
- Contener: revocar sesiones del actor; suspender su membresía.
- Investigar: comparar con `ActivityLog` y `BillingAttemptEvent`; revisar permisos (OWNER/ADMIN).
- Recuperar: restaurar datos correctos; facturas READY vuelven a DRAFT automáticamente cuando
  cambian datos maestros.

### 7. Exposición de base de datos

- Detectar: alerta de Neon, `DATABASE_URL` en un log, repositorio o equipo comprometido.
- Contener: rotar la contraseña del rol en Neon y actualizar `DATABASE_URL` en Vercel;
  restringir accesos.
- Investigar: logs de conexión de Neon; qué datos son accesibles (todos, incluidos documentos).
- Rotar: además, `BETTER_AUTH_SECRET` y tokens de proveedores si pudieron leerse.
- Notificar: todas las Organizations, según decisión legal.
- Recuperar: verificar integridad; restaurar desde respaldo si hubo alteración.

## Después de cada incidente

- Postmortem en el repositorio (sin datos personales ni secretos).
- Tests de regresión.
- Actualizar este documento, el contrato de la fase y el inventario de proveedores si aplica.
