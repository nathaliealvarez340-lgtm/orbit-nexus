# ORBIT NEXUS - CODEX · FASE 5B

## Objetivo

Construir el Invoice Studio profesional de ORBIT NEXUS.

Debe transformar el flujo actual de "Nueva factura" en una experiencia moderna de creación, edición, validación y revisión de CFDI.

Esta fase trabaja únicamente frontend y experiencia de usuario.

NO implementa timbrado real.

Antes de trabajar, leer obligatoriamente:

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT.md`
- `docs/WORKTREE-RULES.md`
- `docs/tasks/FASE5-CONTRACT.md`

---

# 1. Rama asignada

Codex trabaja exclusivamente en:

`codex/fase5-invoice-studio`

Antes de modificar archivos ejecutar:

`git branch --show-current`

`git status --short`

Si la rama no es la correcta, detenerse.

---

# 2. Responsabilidad principal

Codex es responsable exclusivamente de la experiencia frontend del Invoice Studio.

Debe reutilizar y mejorar el flujo actual de facturas emitidas.

NO debe crear otro sistema de facturación paralelo.

Debe trabajar sobre la arquitectura existente:

- `/dashboard/invoices/new`
- `OutgoingInvoiceForm`
- clientes existentes
- FiscalProfile existente
- invoice settings
- borradores existentes
- plan gating existente

---

# 3. Referencia funcional

La experiencia puede inspirarse funcionalmente en sistemas profesionales de facturación como Facture App.

NO copiar visualmente otra aplicación.

ORBIT debe mantener su identidad:

- interfaz oscura;
- superficies graphite/black;
- efecto glass;
- tipografía actual;
- accent color seleccionado por el usuario;
- diseño limpio;
- responsive;
- accesibilidad.

El objetivo es ofrecer toda la capacidad fiscal necesaria con una experiencia más clara y moderna.

---

# 4. Estructura del Invoice Studio

La pantalla debe organizarse conceptualmente en:

1. Emisor
2. Receptor
3. Datos del comprobante
4. Datos de pago
5. Conceptos
6. Impuestos y totales
7. Validación fiscal
8. Acciones de borrador/revisión

Evitar una pantalla caótica llena de campos sin jerarquía.

---

# 5. Emisor

Mostrar claramente los datos de la Organization activa.

Como mínimo:

- razón social;
- RFC;
- régimen fiscal;
- código postal fiscal;
- serie;
- folio o preview de folio;
- estado del perfil fiscal.

El usuario no debe escribir nuevamente datos ya existentes en FiscalProfile.

Si el perfil está incompleto, mostrar el problema claramente y permitir navegar a Perfil fiscal.

No modificar FiscalProfile desde esta tarea salvo mediante flujos existentes.

---

# 6. Receptor

Permitir seleccionar un cliente existente.

Al seleccionar un cliente mostrar/autocompletar:

- razón social;
- RFC;
- régimen fiscal;
- código postal fiscal;
- Uso CFDI predeterminado;
- forma de pago predeterminada;
- correo cuando corresponda.

Si el cliente carece de información necesaria, mostrar advertencia clara.

No permitir que un usuario "invente" silenciosamente datos fiscales fuera del dominio existente.

El backend seguirá siendo la autoridad.

---

# 7. Datos del comprobante

La UI debe soportar los campos definidos en:

`docs/tasks/FASE5-CONTRACT.md`

Incluyendo:

- fecha;
- tipo de comprobante;
- moneda;
- tipo de cambio cuando aplique;
- exportación cuando aplique.

Para este sprint, los tipos generales son:

- I · Ingreso
- E · Egreso
- T · Traslado

No implementar Nómina.

No implementar Complemento de pago.

---

# 8. Uso CFDI

Campo:

`cfdiUse`

Debe mostrarse como catálogo estructurado.

No usar texto libre.

La UI debe mostrar:

`Código · Descripción`

Por ejemplo:

`G03 · Gastos en general`

Cuando existan opciones recomendadas o predeterminadas, mostrarlas sin ocultar la decisión al usuario.

No hardcodear un catálogo alternativo si Claude proporciona la fuente compartida/backend.

---

# 9. Método de pago

Campo:

`paymentMethod`

Opciones:

- `PUE · Pago en una sola exhibición`
- `PPD · Pago en parcialidades o diferido`

La selección debe ser clara y fácil de entender.

Cuando el usuario seleccione PPD, la UI puede sugerir o seleccionar visualmente la forma de pago apropiada según el contrato/reglas disponibles.

La validación fiscal definitiva pertenece al backend.

---

# 10. Forma de pago

Campo:

`paymentForm`

Debe permitir utilizar el catálogo completo disponible.

La experiencia debe permitir buscar por:

- código;
- nombre/descripción.

Ejemplo:

Buscar:

`03`

o:

`Transferencia`

Resultado:

`03 · Transferencia electrónica de fondos`

No limitar artificialmente el selector a efectivo, tarjeta y transferencia.

---

# 11. Catálogos grandes

Para catálogos extensos como:

- claves producto/servicio;
- unidades;

crear una experiencia de búsqueda.

No renderizar miles de opciones simultáneamente si existe una solución de búsqueda más eficiente.

Codex debe consumir el contrato/backend acordado.

No construir un catálogo fiscal independiente del backend.

---

# 12. Catálogo de conceptos

Invoice Studio debe permitir:

- buscar concepto guardado;
- seleccionar concepto guardado;
- crear una línea manual;
- editar el snapshot para esta factura.

Al seleccionar un concepto guardado, precargar cuando exista:

- descripción;
- clave SAT;
- clave unidad;
- cantidad predeterminada;
- precio;
- objeto de impuesto;
- IVA;
- retenciones.

El usuario debe poder modificar los datos de la línea actual sin alterar automáticamente el concepto guardado original.

---

# 13. Líneas de factura

Cada línea debe soportar según el contrato:

- `savedConceptId`
- `description`
- `productCode`
- `unitCode`
- `quantity`
- `unitPrice`
- `discount`
- `taxObject`
- `vatRate`
- `withholdingVatRate`
- `withholdingIsrRate`

La UI debe permitir:

- agregar líneas;
- eliminar líneas;
- editar líneas;
- identificar errores por línea.

No permitir borrar la última línea si eso deja un estado inválido sin feedback.

---

# 14. Tabla/resumen de conceptos

La experiencia debe mostrar de manera clara:

- concepto;
- cantidad;
- unidad;
- precio unitario;
- descuento;
- impuestos;
- importe.

En desktop puede utilizar tabla/editor avanzado.

En mobile debe adaptarse sin depender de una tabla horizontal imposible de usar.

---

# 15. Totales

Mostrar claramente:

- subtotal;
- descuentos;
- impuestos trasladados;
- impuestos retenidos;
- total.

El frontend puede calcular preview para respuesta inmediata.

Los valores persistidos y oficiales vienen del backend.

No enviar cálculos del navegador como autoridad fiscal.

---

# 16. Validación fiscal visual

Crear un panel de validación fácil de entender.

Debe consumir:

`InvoiceValidationResult`

definido en `FASE5-CONTRACT.md`.

Debe poder mostrar algo equivalente a:

- Emisor completo
- Receptor válido
- Comprobante válido
- Datos de pago válidos
- Conceptos válidos
- Totales válidos

Para errores:

- indicar claramente el problema;
- identificar el campo;
- identificar concepto cuando aplique;
- permitir navegar/focalizar el campo cuando sea razonable.

No duplicar toda la lógica fiscal en React.

El backend es la autoridad.

---

# 17. Mensajes

Evitar mostrar al usuario únicamente códigos técnicos.

Preferir mensajes claros.

Ejemplo:

En vez de:

`RECEIVER_POSTAL_CODE_REQUIRED`

mostrar:

`El receptor necesita un código postal fiscal.`

Conservar códigos técnicos solo donde sean útiles para diagnóstico.

---

# 18. Guardar borrador

Debe existir una acción clara:

`Guardar borrador`

El flujo debe utilizar la API definida en el contrato compartido.

Después del guardado:

- informar resultado;
- permitir continuar;
- navegar al detalle/revisión cuando corresponda.

No marcar como emitida una factura por guardar un borrador.

---

# 19. Vista previa

Incluir una acción:

`Vista previa`

La representación debe dejar claro que no es un CFDI timbrado.

Mostrar aviso equivalente a:

`Vista previa · Documento aún no timbrado`

No generar UUID ficticio.

No mostrar sellos fiscales ficticios.

---

# 20. Revisión final

Crear una experiencia de revisión antes del futuro timbrado.

Debe resumir:

- emisor;
- receptor;
- RFC;
- tipo de comprobante;
- Uso CFDI;
- método;
- forma de pago;
- conceptos;
- subtotal;
- impuestos;
- total.

Acciones conceptuales:

- `Seguir editando`
- `Revisar y timbrar`

En este sprint el timbrado real NO existe.

Si se muestra `Revisar y timbrar`, el paso final debe indicar claramente:

- timbrado no configurado;
- integración PAC pendiente;

o quedar preparado visualmente sin simular éxito.

---

# 21. Estados UX

Soportar visualmente estados como:

- editando;
- validando;
- guardando;
- borrador guardado;
- listo para revisión;
- error.

Evitar dobles envíos.

Deshabilitar correctamente acciones durante operaciones async.

Mostrar feedback accesible.

---

# 22. Responsive

La pantalla debe funcionar correctamente en:

- desktop;
- laptop;
- tablet;
- mobile.

En pantallas pequeñas:

- reorganizar secciones;
- evitar tablas horizontales gigantes;
- conservar acciones principales accesibles;
- mantener inputs utilizables;
- mantener la validación visible sin dominar toda la pantalla.

---

# 23. Accesibilidad

Mantener:

- labels reales;
- navegación por teclado;
- focus visible;
- botones icon-only con nombre accesible;
- errores asociados a campos;
- status accesibles;
- contraste adecuado.

No depender únicamente del color para indicar error/éxito.

---

# 24. Archivos que Codex puede modificar

Codex puede modificar, cuando sean necesarios para esta tarea:

- `src/app/dashboard/invoices/new/**`
- `src/components/forms/outgoing-invoice-form.tsx`
- nuevos componentes exclusivamente frontend del Invoice Studio
- estilos/componentes UI relacionados de forma específica con Invoice Studio
- tests frontend relacionados

Puede crear nuevos componentes dentro de:

- `src/components/`

si son específicos o reutilizables sin cambiar contratos backend.

---

# 25. Read-only para Codex

Codex puede leer pero NO modificar:

- `prisma/schema.prisma`
- `prisma/migrations/**`
- `src/services/outgoing-invoices.ts`
- backend fiscal de Claude
- API route handlers de outgoing invoices
- tenant/auth core
- fiscal validation server-side

Si necesita un cambio de contrato:

DETENERSE.

Reportar:

- qué necesita;
- por qué;
- qué campo/ruta afecta.

No modificar backend para "hacer funcionar" el frontend.

---

# 26. Prohibido

No:

- tocar Prisma;
- crear migraciones;
- implementar PAC;
- llamar SAT producción;
- usar Neon;
- desplegar;
- modificar Vercel;
- modificar producción;
- implementar cancelaciones;
- implementar nómina;
- implementar complemento de pagos;
- modificar Ticket Billing;
- alterar sidebar global salvo necesidad explícitamente autorizada;
- rediseñar landing pública;
- simular facturas timbradas.

---

# 27. Pruebas

Ejecutar pruebas relevantes de frontend.

Como mínimo:

- `npm run security:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- E2E relevante de facturación
- `npm run build`
- `git diff --check`
- `git status --short`

Cuando pruebe la app localmente usar:

`npm run dev:local`

Este worktree usa puerto:

`3101`

No utilizar Neon.

---

# 28. Git

Codex NO debe ejecutar:

- `git add`
- `git commit`
- `git push`
- `git merge`
- `git rebase`

salvo instrucción explícita posterior.

No cambiar de rama.

No tocar el worktree de Claude.

---

# 29. Entrega

Al terminar Codex debe reportar:

1. qué implementó;
2. experiencia final del Invoice Studio;
3. archivos modificados;
4. componentes nuevos;
5. contrato backend que consumió;
6. dependencias o cambios requeridos de Claude;
7. pruebas ejecutadas;
8. resultados;
9. problemas pendientes;
10. responsive/accesibilidad verificados;
11. `git status --short`.

No hacer commit ni push.