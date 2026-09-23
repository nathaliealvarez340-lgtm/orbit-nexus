# Arquitectura ORBIT NEXUS

## Límites

- `src/app`: páginas y route handlers. Landing sin cambios; rutas privadas autorizadas antes de acceder a datos.
- `src/lib/auth.ts`: Better Auth, sesiones en base de datos y cookies HttpOnly/Secure/Lax, contraseñas y rate limiting.
- `src/lib/tenant.ts`: resuelve usuario/membresías en cada petición; la cookie de organización es únicamente una preferencia. Nunca se autoriza con un tenantId libre del cliente.
- `src/services`: acceso a datos tenant-aware, transacciones de gasto, factura y auditoría.
- `src/lib/validation.ts`, `upload-validation.ts`, `cfdi.ts`: validación server-side de campos, archivos y CFDI.
- `src/services/ocr/adapter.ts`: OCR HTTP o revisión manual explícita.
- `src/services/invoice-provider/assisted.ts`: portales oficiales curados y campos requeridos.
- `prisma`: modelo, baseline original y migración no destructiva. Claves compuestas aseguran que tickets, documentos, gastos y facturas compartan organización.
- `scripts`: desarrollo local y E2E aislados con PostgreSQL embebido.

## Consistencia

`UPLOADED → ANALYZING → REVIEW → REGISTERED`. La UI expresa Capturado, Analizando, Datos detectados, Revisión, Confirmado y Registrado. Confirmado y Registrado son una sola transacción; nunca hay un gasto persistido sin confirmación. Un error de OCR permite reintentar o revisar manualmente. READY heredado admite revisión. Solo `confirmExpense` crea Expense. Una restricción única por ticket y una actualización condicional impiden duplicados.

Cada consulta privada añade `organizationId` obtenido de una sesión autorizada. Las actualizaciones comprueban estado y tenant. La descarga consulta la misma organización; no usa un path proporcionado por el cliente. CSRF compara el origen; las respuestas privadas no se almacenan en caché compartida. El cambio de workspace y logout descartan el router cache mediante navegación completa.

Preparar facturación produce REQUIRES_DATA o REDIRECT_REQUIRED; no inserta Invoice. Las referencias pueden completarse sin modificar importe/fecha del gasto confirmado. Incorporar un XML revisado valida formato, namespaces, UUID, RFC receptor y total; después almacena archivos privados y factura y actualiza estados en una transacción con auditoría. ISSUED es el enum legado que aquí significa CFDI incorporado; no certifica vigencia ni autenticidad SAT.

## Datos y métricas

Document guarda contenido binario, hash SHA-256, MIME validado y organización; la interfaz no recibe esos bytes salvo mediante el endpoint autorizado. Expense usa Decimal y fecha de compra. La agregación SQL suma gastos confirmados de la organización y año seleccionado; todos los meses aparecen, incluidos ceros. Los importes se convierten a número solo para presentación/gráfica.

ActivityLog se escribe en las transacciones de registro de organización, captura/análisis, confirmación, cambios fiscales, preparación de factura y CFDI; LOGIN se registra al crear sesión si ya hay membresía. Sin membresía, la primera creación de organización audita el registro.

No hay proveedor real de OCR, PAC, correo ni validación SAT configurado en el repositorio. Se conservan archivos mock de fase 1 sin uso en el producto privado. La calculadora de timbrado permanece explícitamente local. Ver README para contratos, migración de usuarios/documentos heredados y requisitos de despliegue.
