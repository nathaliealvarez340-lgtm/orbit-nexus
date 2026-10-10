# ORBIT NEXUS — Retención y eliminación de datos

Estado: **propuesta técnica**. Los plazos marcados "revisión legal/contable" no son decisiones
cerradas y no deben publicarse en el Aviso de Privacidad hasta aprobarse
(`docs/legal/OPEN-LEGAL-ITEMS.md` §4). No se inventan plazos fiscales.

## Situación actual

- No existe eliminación de cuenta, Organization ni documentos en autoservicio. Las solicitudes
  deben atenderse manualmente con un procedimiento revisado (pendiente).
- Borrar un `User` borra en cascada sesiones, cuentas, preferencias, membresías y aceptaciones
  legales; sus eventos de auditoría conservan el registro con `actorUserId = null`.
- **Riesgo de integridad (diseño previo, sin cambios en esta fase):** las FKs hacia `User` de
  `FiscalProfile`, `UploadedFiscalDocument`, `Ticket`, `Invoice` y `StampedInvoice` son
  `ON DELETE CASCADE`. Borrar la cuenta de un miembro eliminaría datos de negocio de la
  Organization creados por esa persona (perfil fiscal, tickets y sus gastos, CFDI, borradores).
  No existe hoy un flujo de baja de cuentas; **antes de implementarlo** debe cambiarse ese
  comportamiento (por ejemplo, `SET NULL` con autor histórico) mediante una migración revisada.
- Borrar una `Organization` borraría en cascada todos sus datos de negocio, pero **está
  bloqueado** si tiene eventos de auditoría (`AuditEvent.organizationId ON DELETE RESTRICT`):
  obliga a decidir qué evidencia conservar antes de eliminar.
- `AuditEvent` es append-only (trigger). Una purga por retención requiere un procedimiento
  ejecutado por el operador, revisado y registrado.
- Los documentos se guardan en la base de datos (`Document.content`), así que eliminarlos de la
  base no los elimina de respaldos hasta que estos expiran.

## Mapa

| Dato | Motivo | Sensibilidad | Retención propuesta | Condición de eliminación | Excepción pendiente | Ubicación |
|---|---|---|---|---|---|---|
| Usuario / cuenta | Autenticación y titularidad | CONFIDENTIAL | Mientras la cuenta esté activa | Solicitud del titular; inactividad prolongada (plazo por definir) | Conservar evidencia de aceptación legal: revisión legal | `User`, `Account` (Neon) |
| Sesiones | Mantener sesión | SECRET / CONFIDENTIAL | 7 días desde la última renovación | Expiración, cierre de sesión, reset de contraseña | — | `Session` |
| Tokens de verificación/reset | Recuperación de cuenta | SECRET | Hasta su expiración | Uso o expiración; limpieza periódica (job pendiente) | — | `Verification` |
| Contadores de rate limit | Prevenir abuso | INTERNAL | Ventana de cada límite | Reutilización de la clave; limpieza periódica (job pendiente) | — | `RequestLimit`, `RateLimit` |
| Organization y membresías | Aislamiento y permisos | CONFIDENTIAL | Mientras exista la Organization | Cierre solicitado por OWNER (procedimiento pendiente) | Documentos fiscales sujetos a plazo legal | `Organization`, `Membership` |
| Perfil fiscal | Facturación y billing | FISCAL_SENSITIVE | Mientras la Organization esté activa | Con la Organization | Plazo fiscal de conservación: revisión legal/contable | `FiscalProfile` |
| CSF (propia y de clientes) | Prellenado y completitud del perfil | FISCAL_SENSITIVE | Mientras sea la constancia vigente | Reemplazo por una nueva o solicitud; hoy no hay borrado (FK `RESTRICT` desde consentimientos/extracciones) | Revisión legal | `Document` |
| Consentimientos y extracciones de CSF | Evidencia de autorización y datos detectados | CONFIDENTIAL / FISCAL_SENSITIVE | Mientras exista el documento | Con el documento | Evidencia de consentimiento: revisión legal | `FiscalDocumentConsent`, `FiscalDocumentExtraction` |
| Clientes | Facturación a clientes | FISCAL_SENSITIVE | Mientras la Organization esté activa; archivados conservan integridad histórica | Solicitud de la Organization o del titular | Clientes con CFDI asociados: plazo fiscal, revisión legal/contable | `Client` |
| Tickets / imágenes | Registro de gasto y facturación | FISCAL_SENSITIVE | Mientras la Organization esté activa | Solicitud (procedimiento pendiente) | Soporte de deducciones: revisión contable | `Document`, `Ticket` |
| OCR bruto | Auditoría del extractor | FISCAL_SENSITIVE | Propuesta: hasta confirmar el ticket más un periodo corto | Por definir | Arquitectura exige conservarlo (Raw): decidir plazo | `TicketOcrAttempt` |
| Gastos | Reportes | FISCAL_SENSITIVE | Mientras la Organization esté activa | Con la Organization | Plazo fiscal: revisión legal/contable | `Expense` |
| CFDI XML | Evidencia fiscal | FISCAL_SENSITIVE | Al menos el plazo fiscal aplicable | Fin del plazo y solicitud | **Plazo fiscal: revisión legal/contable** | `Document`, `Invoice` |
| PDFs (CFDI, reportes generados) | Representación impresa | FISCAL_SENSITIVE | Igual que el XML; los reportes exportados no se almacenan | Igual que el XML | Revisión legal/contable | `Document` |
| Borradores de facturación | Preparación de CFDI | FISCAL_SENSITIVE | Mientras la Organization esté activa | Solicitud | Al timbrarse (fase futura): plazo fiscal | `StampedInvoice` |
| Reportes mensuales | Cierre de gastos | FISCAL_SENSITIVE | Mientras la Organization esté activa | Con la Organization | Revisión contable | `MonthlyExpenseReport` |
| Notificaciones | Avisos del servicio | CONFIDENTIAL | Propuesta: 12 meses | Antigüedad (job pendiente) | — | `Notification` |
| ActivityLog | Feed y trazabilidad operativa | INTERNAL / CONFIDENTIAL | Propuesta: igual que auditoría | Con la Organization | Revisión legal | `ActivityLog` |
| AuditEvent | Evidencia de seguridad | CONFIDENTIAL | Propuesta: mayor que la de los datos auditados | Procedimiento de purga del operador | **Revisión legal** | `AuditEvent` |
| Aceptaciones legales | Evidencia contractual | CONFIDENTIAL | Mientras la cuenta exista (hoy se borran con el usuario) | Con el usuario | Conservar tras baja: revisión legal | `LegalAcceptance` |
| Logs de aplicación | Diagnóstico | INTERNAL | Según el plan de Vercel (verificar) | Automática por la plataforma | — | Vercel |
| Respaldos | Recuperación | Igual que los datos | Según el plan de Neon (verificar) | Expiración del respaldo | Coordinar con solicitudes de eliminación | Neon |
| Analytics | No existe | — | — | — | — | — |
| Cookies | Sesión y preferencias | SECRET / INTERNAL | Sesión 7 días; organización 7 días; consentimiento 6 meses | Expiración o cierre de sesión | — | Navegador |
| Futuro CSD | Timbrado | SECRET | Mientras el usuario lo mantenga vigente | Revocación, reemplazo, vencimiento o solicitud: destrucción verificable | Diseño de la fase CSD | No existe |

## Trabajo pendiente

1. Procedimiento documentado de eliminación por solicitud (cuenta, Organization, documento),
   con registro `sensitive_asset.deleted` y respeto de plazos de bloqueo fiscal.
2. Jobs de limpieza: sesiones/verificaciones expiradas, `RequestLimit` expirados,
   notificaciones antiguas.
3. Decidir el tratamiento de respaldos ante solicitudes de eliminación.
4. Decidir la retención de evidencia (auditoría, consentimientos, aceptaciones) tras la baja.
