# ORBIT NEXUS — Pendientes legales y empresariales

Lo que Nathalie debe definir antes de publicar el Aviso de Privacidad y los Términos como
documentos definitivos. Mientras falte un punto marcado **bloqueante**, el documento permanece
en `DRAFT`, no puede aceptarse y, en el caso del Aviso, la lectura de documentos fiscales queda
bloqueada en producción.

Dónde se capturan los datos: `src/lib/legal/facts.ts` (hechos) y `src/lib/legal/registry.ts`
(versión, fecha de vigencia, aprobación). Cada cambio exige una nueva versión.

ORBIT no ha redactado estos datos ni los ha supuesto. El contenido actual describe el
funcionamiento técnico real; su adecuación legal requiere revisión de un abogado.

---

## 1. Identidad del responsable — bloqueante (Aviso y Términos)

- Nombre o razón social del responsable del tratamiento y titular de ORBIT NEXUS.
- Domicilio para oír y recibir notificaciones.
- Si existe, RFC y representante legal (solo si el abogado indica que deben aparecer).
- Campo: `legalFacts.controller`.

## 2. Contacto de privacidad — bloqueante (Aviso)

- Medio para ejercer derechos ARCO, revocar el consentimiento y limitar el uso o divulgación
  (por ejemplo, un correo dedicado). Debe existir y estar atendido.
- Procedimiento y requisitos de las solicitudes (identificación, plazos de respuesta) conforme a
  la legislación vigente. **No se redactaron plazos.**
- Campo: `legalFacts.privacyContact`.

## 3. Contacto sobre términos — bloqueante (Términos)

- Medio de contacto para asuntos contractuales y soporte.
- Campo: `legalFacts.termsContact`.

## 4. Plazos de conservación — bloqueante (Aviso)

- Plazos por categoría de dato, en particular documentos y registros fiscales (requiere
  revisión legal y contable). Ver `docs/security/DATA-RETENTION.md`.
- Qué ocurre con la evidencia de consentimientos y auditoría cuando se elimina una cuenta u
  Organization (hoy: `LegalAcceptance` se borra con el usuario; `AuditEvent` impide borrar una
  Organization con historial).
- Campo: `legalFacts.retentionStatement`.

## 5. Proveedores e infraestructura — bloqueante (Aviso)

- Confirmar la región de Vercel y de Neon y, si están fuera de México, cómo se informan las
  transferencias internacionales.
- Identificar los proveedores reales de OCR, correo transaccional y automatización de portales
  si se habilitan en producción (hoy no hay ninguno identificado en el repositorio).
- Clasificación jurídica de cada flujo (remisión a encargado vs. transferencia) y si alguna
  transferencia requiere consentimiento.
- Campo: `legalFacts.providerDisclosure`. Ver `docs/security/SUBPROCESSORS.md`.

## 6. Legislación aplicable y jurisdicción — bloqueante (Términos)

- Ley aplicable, tribunales competentes y, si aplica, mecanismos de resolución de disputas.
- Campo: `legalFacts.governingLawAndJurisdiction`.

## 7. Revisión jurídica y vigencia — bloqueante (ambos)

- Revisión del texto completo por un abogado, incluido el marco legal de protección de datos
  personales vigente en México y la autoridad competente.
- Fecha de entrada en vigor de cada versión.
- Al aprobar: `legalPublications[kind] = { version, status: "PUBLISHED", effectiveDate,
  legalReviewApproved: true }` con una versión nueva.

## 8. Decisiones de consentimiento — no bloqueante para publicar, sí para lanzar

- Si el Aviso requiere consentimiento expreso para datos financieros/patrimoniales y en qué
  momento se recaba (registro, primer uso fiscal, o ambos).
- Si la aceptación de términos y aviso será obligatoria para usar la aplicación (el mecanismo
  `POST /api/legal/acceptances` existe; el bloqueo de uso no está implementado).
- Si la aceptación de términos debe ser del usuario o de la Organization (B2B). Hoy es personal.
- Si la evidencia de aceptación debe incluir IP o agente de usuario (hoy no se guardan, por
  minimización).

## 9. Condiciones comerciales — no bloqueante mientras no se cobre

- Precios, periodicidad, forma de pago, facturación del servicio, cancelación y reembolsos de
  los planes FREE/PRO/MAX. Los Términos indican que esta versión no procesa cobros.

## 10. Datos de clientes del usuario — revisar con abogado

- Rol de ORBIT respecto de los datos de los clientes de cada Organization (por ejemplo,
  encargado) y si se requiere un contrato de tratamiento con cada Organization.

## 11. Soporte y disponibilidad — no bloqueante

- Canales, horarios y compromisos de nivel de servicio, si existen. Los Términos no prometen
  un nivel de servicio.

## 12. Antivirus de documentos — decisión de riesgo antes de producción

- Aceptar el riesgo residual sin escaneo o contratar un proveedor (implica nuevo
  subprocesador y actualización del Aviso).

## 13. Notificación de incidentes — antes de producción

- Responsable de decidir y emitir notificaciones a titulares y autoridades, y plantillas.
  Ver `docs/security/INCIDENT-RESPONSE.md`.

## 14. Futuro CSD — antes de la fase de timbrado

- Términos específicos de custodia del CSD, responsabilidad por su uso y revocación.
- Actualización del Aviso: hoy declara que ORBIT no solicita ni custodia CSD ni e.firma.
