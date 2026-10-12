# ORBIT NEXUS — CODEX · Fase 5C.3 (UI de CSD)

## Rol

UI/UX de configuración del Certificado de Sello Digital: carga, estados, errores, sustitución,
deshabilitado, historial, responsive y accesibilidad. El backend es la autoridad; la UI no
valida criptografía ni decide permisos.

---

# 1. Lectura obligatoria

1. `AGENTS.md`, `docs/WORKTREE-RULES.md`.
2. `docs/tasks/FASE5C3-CONTRACT.md` (§C estados, §D permisos, §N errores, §O APIs, §P DTOs,
   §R sanitización, §S límites, §W–§Y comportamientos).
3. `docs/tasks/FASE5C-CONTRACT.md` §12 (separación CSF/CSD y mensajes), §13.3 (qué puede
   mostrarse), §33 (ownership de Codex).
4. `src/types/fiscal-identity.ts` (`CsdStatus`, `CsdSummary`, `CsdErrorCode`) y
   `src/types/csd.ts` (lo crea Claude en el Bloque 2; hasta entonces, construir contra el
   contrato).

---

# 2. Reglas

- No implementar criptografía, parseo de certificados ni validación de la llave en el
  navegador.
- No guardar `.cer`, `.key` ni contraseña en `localStorage`, `sessionStorage`, IndexedDB,
  cookies, estado global persistente, URL ni analytics.
- No mostrar vistas previas, miniaturas ni nombres de archivo de vuelta desde el servidor.
- No añadir la página ni las rutas de CSD a `src/lib/analytics-policy.ts`. Ningún archivo
  `.cer`/`.key`, nombre de archivo, tamaño, contraseña, código de error ni resultado de
  validación del CSD se envía a analytics ni a telemetría del cliente.
- **No inventar estados, campos, códigos ni endpoints.** Solo los de `FASE5C3-CONTRACT.md`
  (§C, §N, §O, §P). Si falta algo, detenerse y reportarlo a Claude.
- No tocar Prisma, migraciones, `src/lib/csd/**`, `src/services/**`, `src/app/api/**` ni
  `src/types/fiscal-identity.ts` / `src/types/stamping.ts`.
- Mocks de transporte solo en pruebas de UI; nunca en la aplicación.
- No commit, push ni deploy sin instrucción explícita.

---

# 3. Ubicación (decisión cerrada)

- **`/dashboard/stamping` es la fuente única** de administración del CSD: carga, sustitución,
  deshabilitado e historial. Hoy esa ruta redirige a `/dashboard/invoices/new`; pasa a ser la
  página del CSD.
- Perfil Fiscal e Invoice Studio **solo** muestran estado/resumen (`CsdStatus`, vigencia,
  ambiente) y un enlace a `/dashboard/stamping`. No tienen formularios ni acciones de CSD.
- No crear `/dashboard/fiscal-profile/csd` ni ninguna otra pantalla de configuración.
- `scripts/e2e.mjs:855` espera hoy la redirección de `/dashboard/stamping` a
  `/dashboard/invoices/new`. No se modifica ahora; esa expectativa se actualiza junto con la
  implementación real de la pantalla `/dashboard/stamping`.

Texto obligatorio de separación (FASE5C §12):

- "La Constancia de Situación Fiscal identifica información fiscal."
- "El Certificado de Sello Digital se utiliza para sellar CFDI."
- Aviso explícito: "No subas tu e.firma (FIEL). ORBIT nunca la solicita."

---

# 4. Estados visibles (`GET /api/csd` → `CsdState`)

| Estado | Presentación |
|---|---|
| `serviceAvailable: false` | "La custodia de CSD no está disponible en este entorno." Sin formulario. |
| `NOT_CONFIGURED` | Explicación y formulario de carga (solo si `canManage`). |
| `VALIDATING` | Estado local mientras se envía; deshabilitar el botón y anunciarlo a lectores de pantalla. El backend nunca lo devuelve. |
| `VALID` | Número de certificado, RFC, vigencia, ambiente (`SANDBOX` con insignia visible), fecha de configuración; aviso si `expiresSoon`. Acciones Sustituir/Deshabilitar si `canManage`. |
| `EXPIRED` | Indicar vencimiento y que el timbrado está bloqueado; acción Sustituir. |
| `INVALID` | Mensaje según `invalidReason` (`NOT_YET_VALID`, `RFC_CHANGED`, `KEY_UNAVAILABLE`, `INTEGRITY`); acción Sustituir. |

`verification.csdTypeVerifiedLocally === false` se muestra como: "ORBIT verificó el certificado
y la llave; el SAT y el PAC confirman el tipo de certificado al timbrar."

MEMBER: `GET /api/csd` responde 403; mostrar "Solo un administrador puede ver y gestionar el
CSD" sin detalles, formulario ni historial.

---

# 5. Formulario de configuración (`POST /api/csd`, multipart)

Campos (nombres exactos del contrato §O):

- `certificate`: archivo, `accept=".cer"`.
- `privateKey`: archivo, `accept=".key"`.
- `password`: con `PasswordInput` (`src/components/ui/password-input.tsx`),
  `autocomplete="off"`, sin "recordar"; mostrar/ocultar permitido.
- Casilla de custodia **sin marcar**, con el texto de `GET /api/csd/custody-terms`; se envían
  `accepted=true` y `custodyTermsVersion`.
- Sustitución: `replace=true` y `expectedActiveCsdId` del estado leído.

Patrones existentes a reutilizar (no crear componentes paralelos):

- `PasswordInput` (`src/components/ui/password-input.tsx`) para la contraseña.
- `FormFeedback` (`src/components/forms/form-feedback.tsx`) para errores y confirmaciones.
- El patrón de `PrivateAsset` (`src/components/forms/private-asset.tsx`) para selección de
  archivos privados, adaptado a dos archivos y sin vista previa ni enlace de descarga.

Comportamiento:

- Validación previa en el cliente solo de presencia, extensión y tamaño (16 KiB por archivo,
  contraseña ≤ 256), sin sustituir la del backend.
- **La contraseña desaparece inmediatamente:** se copia al `FormData` y el campo y su estado se
  vacían en el mismo momento del envío, antes de esperar la respuesta; al recibir el resultado
  (éxito o error) no se restaura. Nunca se guarda en otra variable de estado, ref, log ni
  mensaje.
- En éxito también se limpian los archivos; en error se conservan solo en el formulario en
  memoria para reintentar.
- Nunca reenviar automáticamente ni reintentar en segundo plano.
- Sustituir y deshabilitar requieren confirmación explícita (diálogo accesible).
- `CSD_CONFLICT` ⇒ recargar estado y pedir que revise antes de repetir.
- `CSD_REAUTH_REQUIRED` (401) ⇒ explicar que por seguridad debe iniciar sesión de nuevo,
  enviar al inicio de sesión y regresar a `/dashboard/stamping`. La contraseña de la `.key` y
  los archivos se descartan.

---

# 6. Errores (`{ error, code }`)

Mapear `code` a mensajes propios en español; no mostrar textos técnicos. Base:

| Código | Mensaje sugerido |
|---|---|
| `CSD_FILES_REQUIRED` | "Selecciona el .cer, el .key y escribe la contraseña de la llave." |
| `CSD_CUSTODY_TERMS_REQUIRED` | "Debes aceptar la custodia del CSD para continuar." |
| `CSD_CERTIFICATE_INVALID` | "El archivo .cer no es un certificado válido." |
| `CSD_KEY_INVALID` | "El archivo .key no es una llave privada válida." |
| `CSD_PASSWORD_INVALID` | "No pudimos abrir la llave privada con la contraseña proporcionada." |
| `CSD_KEY_MISMATCH` | "El certificado y la llave privada no corresponden entre sí." |
| `CSD_EXPIRED` | "El Certificado de Sello Digital está vencido." |
| `CSD_NOT_YET_VALID` | "El certificado todavía no está vigente." |
| `CSD_RFC_MISMATCH` | "El RFC del certificado no corresponde al emisor configurado." |
| `CSD_RFC_UNVERIFIABLE` | "No pudimos confirmar el RFC del certificado." |
| `CSD_ISSUER_PROFILE_REQUIRED` | "Completa y confirma tu Perfil Fiscal antes de configurar el CSD." |
| `CSD_FILE_TOO_LARGE` | "El archivo excede el tamaño permitido." |
| `CSD_UNSUPPORTED` | "Este certificado o llave usa un formato que ORBIT no admite." |
| `CSD_ALREADY_ACTIVE` | "Ya tienes un CSD activo. Usa Sustituir." |
| `CSD_CONFLICT` | "El CSD cambió mientras trabajabas. Revisa el estado actual." |
| `CSD_IN_USE` | "Hay un timbrado en curso. Intenta en unos minutos." |
| `CSD_FORBIDDEN` | "Solo un administrador puede gestionar el CSD." |
| `CSD_REAUTH_REQUIRED` | "Por seguridad, vuelve a iniciar sesión para continuar." |
| `CSD_ENVIRONMENT_MISMATCH` | "Este certificado no corresponde al ambiente configurado. En pruebas solo se aceptan CSD de prueba." |
| `CSD_RATE_LIMITED` | "Demasiados intentos. Espera unos minutos." |
| `CSD_SERVICE_UNAVAILABLE` / `CSD_ENCRYPTION_FAILED` | "No pudimos completar la operación. Intenta más tarde." |
| `CSD_NOT_FOUND` | "No hay un CSD activo." |

Errores sin `code` (403/429/503 genéricos): mensaje genérico; nunca `error` crudo de una
librería.

---

# 7. Historial (`GET /api/csd/history`, OWNER/ADMIN)

Tabla accesible con número de certificado, RFC, ambiente, vigencia, estado (`ACTIVE`,
`REPLACED`, `DISABLED`), configurado por (nombre) y fechas. Sin acciones sobre filas antiguas.

---

# 8. Feed del dashboard y resúmenes

- Los eventos de CSD solo existen en `AuditEvent` (`csd.configuration.started`,
  `csd.configured`, `csd.configuration.failed`, `csd.replaced`, `csd.disabled`). No hay eventos
  `CSD_*` en `ActivityLog`: no agregar etiquetas de CSD en `src/lib/display.ts`.
- Resumen en Perfil Fiscal e Invoice Studio: estado (`CsdStatus`), vigencia y ambiente, más el
  enlace "Administrar CSD" a `/dashboard/stamping`. Para MEMBER (403) mostrar solo que el CSD
  lo administra un OWNER/ADMIN.

---

# 9. Responsive y accesibilidad

- Campos con `label` explícito; errores asociados con `aria-describedby`; foco al primer error.
- Botones con estado de carga anunciado (`aria-busy`/región viva).
- Diálogos de confirmación con foco atrapado y cierre con Escape.
- Contraste y foco visible; insignia `SANDBOX` legible.
- Móvil: formulario en una columna; tabla de historial apilable.

---

# 10. Pruebas (Codex)

- Harness de UI con transporte simulado (solo en tests): cada `CsdStatus` e
  `invalidReason`; MEMBER con 403 y aviso sin detalles; `serviceAvailable: false`.
- Cada código de error mapeado a su mensaje.
- La contraseña desaparece del campo y del estado en el momento del envío y no reaparece tras
  éxito ni error.
- Confirmaciones de sustituir/deshabilitar; `CSD_CONFLICT` recarga el estado;
  `CSD_REAUTH_REQUIRED` lleva a iniciar sesión y regresa a `/dashboard/stamping`.
- `/dashboard/stamping` es la única página con formulario de CSD; Perfil Fiscal e Invoice
  Studio solo muestran resumen y enlace.
- Ni la página ni ningún dato del CSD llegan a analytics (allowlist intacta y sin eventos).
- Responsive (móvil/tablet/escritorio) y axe sin violaciones.
- Después de integrar el backend de Claude: E2E real contra el servidor local con
  certificados sintéticos provistos por los tests de Claude.

---

# 11. Dependencias con Claude

- `src/types/csd.ts` y las rutas `/api/csd`, `/api/csd/custody-terms`, `/api/csd/disable`,
  `/api/csd/history` llegan en el Bloque 2 de Claude, junto con `CSD_REAUTH_REQUIRED`
  (autenticación reciente, ventana de 15 minutos configurable).
- El texto de custodia es provisional hasta la revisión jurídica (§AB.2); la UI lo muestra tal
  como lo sirve el backend.
- Cualquier cambio a estados, códigos, campos o rutas se reporta y acuerda; no se adapta en
  silencio.
