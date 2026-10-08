# ORBIT NEXUS - CODEX FASE 5C

## Rol

Codex trabaja exclusivamente en:

`Fase 5C-B · Fiscal UX`

Su responsabilidad principal es frontend, experiencia de usuario, integración visual con las APIs fiscales, accesibilidad, responsive y comportamiento seguro durante los flujos de identidad fiscal y timbrado.

Codex NO es responsable de criptografía, firma CFDI, lógica PAC ni migraciones fiscales.

---

# 1. Lectura obligatoria antes de modificar código

Antes de implementar cualquier cambio, leer completamente:

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT.md`
- `docs/WORKTREE-RULES.md`
- `docs/tasks/FASE5C-CONTRACT.md`
- `docs/tasks/CODEX-FASE5C.md`

También revisar las implementaciones existentes de:

- Fase 3;
- Fase 4;
- Fase 5A;
- Fase 5B.

No asumir que una ruta, componente, hook o API funciona de cierta manera sin verificarlo en el repositorio.

Si el trabajo toca comportamiento específico de Next.js, leer primero la documentación correspondiente disponible en:

`node_modules/next/dist/docs/`

según las reglas de `AGENTS.md`.

---

# 2. Regla principal

`docs/tasks/FASE5C-CONTRACT.md`

es la fuente de verdad de Fase 5C.

Codex NO puede modificar silenciosamente:

- estados;
- contratos;
- rutas compartidas;
- semántica de READY;
- semántica de ISSUED;
- flujo de consentimiento;
- comportamiento de CSD;
- PacProvider;
- idempotencia;
- manejo de UNKNOWN;
- reglas fiscales;
- ownership.

Si considera necesario cambiar el contrato:

1. detener implementación;
2. documentar el problema;
3. explicar el cambio requerido;
4. esperar decisión humana.

No adaptar silenciosamente la UX para ocultar una limitación del backend.

---

# 3. Entorno de trabajo

Codex trabaja únicamente en su worktree asignado.

NO trabajar en:

`main`

NO modificar directamente el worktree de Claude.

NO hacer:

- merge a main;
- force push;
- deploy;
- cambios en Neon producción;
- migraciones sobre producción;
- configuración de Vercel producción;
- operaciones destructivas externas.

Los cambios quedan preparados en la rama de Codex para revisión e integración posterior.

No realizar commits salvo instrucción expresa.

---

# 4. Objetivo general

Implementar la experiencia completa de Fase 5C alrededor de:

- Perfil Fiscal;
- Constancia de Situación Fiscal;
- consentimiento;
- autocompletado;
- régimen fiscal;
- Clientes;
- Constancia opcional de clientes;
- Uso CFDI;
- configuración visual de CSD;
- revisión final de CFDI;
- autorización de timbrado;
- estados del StampAttempt;
- errores PAC;
- estado UNKNOWN;
- resultado ISSUED;
- descargas XML/PDF;
- navegación;
- responsive;
- accesibilidad.

El backend sigue siendo la autoridad fiscal.

Frontend nunca determina por sí solo que una factura es válida, timbrada o ISSUED.

---

# 5. Alcance visual

Fase 5C NO es el rediseño completo de ORBIT.

No rehacer:

- dashboard completo;
- identidad visual global;
- sistema de componentes entero;
- Invoice Studio desde cero;
- layout general sin necesidad funcional.

Aplicar únicamente mejoras necesarias para:

- claridad;
- seguridad;
- consistencia;
- legibilidad;
- accesibilidad;
- funcionamiento de los nuevos flujos.

El rediseño visual general se realizará después de completar funcionalidad.

---

# 6. Perfil Fiscal

Modificar la experiencia de Perfil Fiscal para que la Constancia de Situación Fiscal aparezca ANTES del formulario manual.

Orden esperado:

1. título y explicación;
2. carga de Constancia;
3. autorización;
4. procesamiento;
5. datos detectados;
6. revisión/corrección;
7. formulario fiscal;
8. confirmación;
9. guardar.

El usuario puede seguir llenando el formulario manualmente sin subir Constancia.

---

# 7. Carga de Constancia del emisor

La UI debe permitir seleccionar un PDF de Constancia de Situación Fiscal.

Después de seleccionar el archivo:

NO iniciar procesamiento fiscal inmediatamente.

Primero mostrar autorización.

Texto base:

> Autorizo a ORBIT NEXUS a leer esta Constancia de Situación Fiscal con la finalidad de extraer y prellenar mis datos fiscales. Podré revisar y corregir la información antes de guardarla. Esta autorización no implica la emisión de CFDI ni autoriza el uso de mi e.firma.

La casilla inicia:

`desmarcada`

Hasta que el usuario acepte:

- no llamar al procesamiento;
- no mostrar datos como detectados;
- no asumir consentimiento.

---

# 8. Estados de lectura de CSF

La UI debe representar claramente estados equivalentes a:

- archivo seleccionado;
- esperando autorización;
- procesando;
- procesado;
- parcialmente detectado;
- requiere revisión;
- error de lectura.

No mostrar loading infinito.

No presentar un resultado incompleto como éxito total.

Mensaje de fallo de referencia:

`No pudimos identificar todos los datos de tu Constancia. Puedes revisarlos y completarlos manualmente.`

La captura manual debe permanecer disponible.

---

# 9. Datos detectados

Los campos obtenidos mediante extracción deben poder distinguirse visualmente como:

- detectados;
- modificados;
- pendientes de revisión.

No convertir visualmente un dato detectado en dato confirmado sin acción del usuario.

Cuando exista baja confianza o ambigüedad:

mostrar estado de revisión.

Evitar mensajes técnicos como:

`LOW_CONFIDENCE`

como texto principal de usuario.

Puede mostrarse algo equivalente a:

`Revisa este dato antes de continuar.`

---

# 10. Confirmación de datos del emisor

Antes de guardar información extraída automáticamente, mostrar:

> Revisé y confirmo que mis datos fiscales son correctos.

La confirmación inicia desmarcada.

Después de guardar correctamente:

`✓ Información guardada correctamente`

No mostrar éxito si backend devuelve error.

---

# 11. Régimen fiscal

Eliminar el uso de texto libre para régimen fiscal donde Fase 5C lo requiera.

Usar selector controlado.

Formato visual:

`Código · Descripción`

Ejemplo:

`601 · General de Ley Personas Morales`

El selector debe permitir:

- búsqueda por código;
- búsqueda por descripción;
- teclado;
- mouse;
- touch;
- estado seleccionado;
- loading;
- error de catálogo;
- empty state.

No hardcodear el catálogo completo dentro del componente.

Consumir la fuente server-side definida por backend.

---

# 12. Múltiples regímenes

Si la CSF devuelve varios regímenes:

mostrar todos.

No seleccionar silenciosamente el primero.

El usuario debe elegir explícitamente cuál utilizar cuando el flujo lo requiera.

Mostrar:

- código;
- descripción;
- estado actual cuando corresponda.

No descartar las otras opciones durante la revisión.

---

# 13. Cliente: creación y edición

Actualizar la experiencia de Clientes para soportar correctamente:

- RFC;
- nombre o razón social;
- código postal;
- régimen fiscal;
- Uso CFDI.

La Constancia del cliente es:

`opcional pero recomendada`

No presentarla como requisito obligatorio.

No bloquear creación del cliente únicamente porque no existe CSF.

---

# 14. Constancia opcional del cliente

Si el usuario decide subir la Constancia de un cliente:

1. seleccionar archivo;
2. mostrar declaración;
3. esperar aceptación;
4. procesar;
5. mostrar datos detectados;
6. revisar;
7. corregir;
8. confirmar;
9. guardar.

Texto base:

> Declaro que cuento con facultades o una base legítima para proporcionar y tratar esta información fiscal del cliente con la finalidad de administrar y preparar sus comprobantes fiscales en ORBIT NEXUS.

La casilla inicia desmarcada.

No procesar antes de aceptar.

---

# 15. Confirmación de datos del cliente

Antes de guardar datos extraídos:

> Revisé y confirmo que los datos fiscales del cliente son correctos.

Después de guardar:

`✓ Información guardada correctamente`

Si existen datos actuales y datos detectados distintos:

mostrar comparación.

No sobrescribir silenciosamente.

---

# 16. Uso CFDI

Uso CFDI debe utilizar su catálogo correspondiente.

No inferir Uso CFDI a partir de la Constancia.

No seleccionar automáticamente una opción únicamente por régimen.

El selector debe:

- mostrar código;
- mostrar descripción;
- permitir búsqueda cuando sea útil;
- reflejar validaciones de backend;
- mostrar errores fiscales de forma entendible.

---

# 17. Formulario y validaciones

Frontend puede realizar validaciones de experiencia:

- requerido;
- formato básico;
- longitud;
- estado de loading;
- mensajes inmediatos.

Pero backend sigue siendo autoridad para:

- RFC;
- régimen;
- Uso CFDI;
- compatibilidades;
- READY;
- reglas fiscales.

No duplicar un motor fiscal completo en frontend.

No declarar válido un CFDI únicamente porque el formulario no muestra errores.

---

# 18. Configuración visual del CSD

Crear o adaptar UI para configuración de Certificado de Sello Digital.

El usuario debe entender claramente la diferencia entre:

`Constancia de Situación Fiscal`

y:

`Certificado de Sello Digital`

La pantalla debe permitir proporcionar:

- `.cer`;
- `.key`;
- contraseña.

No solicitar e.firma.

---

# 19. Seguridad visual del CSD

La UI nunca debe:

- volver a mostrar la contraseña después de enviarla;
- mostrar contenido de `.key`;
- ofrecer descarga de llave privada;
- mostrar rutas internas;
- mostrar secretos PAC;
- guardar contraseña en localStorage;
- guardar contraseña en sessionStorage;
- persistir contraseña en estado global permanente;
- registrar contraseña en analytics.

El campo de contraseña debe comportarse como dato efímero.

Después de envío exitoso o fallo terminal:

limpiar el valor cuando sea razonable.

---

# 20. Estado del CSD

Mostrar estados amigables equivalentes a:

- no configurado;
- validando;
- válido;
- inválido;
- vencido.

Backend determina el estado real.

Ejemplos visuales:

`CSD configurado y válido`

`El CSD requiere atención`

`El certificado está vencido`

No habilitar acción de timbrado si backend indica que CSD no es VALID.

---

# 21. Errores de CSD

Mostrar mensajes claros sin revelar detalles criptográficos sensibles.

Ejemplos:

`No pudimos abrir la llave privada con la contraseña proporcionada.`

`El certificado y la llave privada no corresponden entre sí.`

`El Certificado de Sello Digital está vencido.`

`El RFC del certificado no corresponde al emisor configurado.`

No mostrar:

- stack trace;
- llave;
- certificado completo;
- secretos;
- error criptográfico interno innecesario.

---

# 22. Invoice Studio

No rediseñar Invoice Studio completo.

Agregar únicamente los elementos necesarios para Fase 5C.

Antes del timbrado debe existir revisión final de:

- emisor;
- receptor;
- RFC;
- régimen fiscal;
- Uso CFDI;
- tipo de comprobante;
- moneda;
- método de pago;
- forma de pago;
- conceptos;
- descuentos;
- impuestos;
- retenciones;
- subtotal;
- total.

Los datos mostrados deben venir del estado validado por backend.

---

# 23. Autorización final de timbrado

Antes del submit productivo mostrar:

> Revisé la información del CFDI y autorizo a ORBIT NEXUS a utilizar el Certificado de Sello Digital configurado para sellar este comprobante y enviarlo al PAC para su certificación.

La casilla:

- inicia desmarcada;
- aplica a esa factura;
- no representa autorización permanente;
- no autoriza e.firma.

El botón principal debe indicar claramente:

`Timbrar CFDI`

No usar:

- Guardar;
- Continuar;
- Finalizar;

para una operación real de timbrado.

---

# 24. Estado READY

Cuando backend indique READY:

mostrar:

`La factura está validada y lista para timbrarse.`

READY NO significa:

- timbrada;
- emitida;
- certificada;
- UUID disponible.

No mostrar iconografía o lenguaje que pueda confundirse con emisión concluida.

---

# 25. SIGNING

Mientras backend indique proceso de firma:

mostrar:

`Preparando y sellando el CFDI.`

Deshabilitar:

- submit repetido;
- edición fiscal incompatible;
- acciones que puedan generar una segunda operación.

No simular progreso numérico si backend no proporciona uno real.

---

# 26. SUBMITTING y WAITING_PROVIDER

Durante envío al PAC mostrar:

`Enviando el CFDI al proveedor de certificación.`

El usuario debe entender que la operación sigue en proceso.

No permitir:

- segundo timbrado;
- edición;
- eliminación del draft;
- duplicación accidental.

Refresh no debe provocar una nueva emisión.

Al volver a la pantalla:

consultar estado existente.

---

# 27. UNKNOWN

UNKNOWN requiere una UI específica.

Texto base:

`Estamos verificando el estado de este CFDI. No vuelvas a timbrarlo mientras realizamos la comprobación.`

En UNKNOWN:

- bloquear nuevo submit;
- no mostrar error definitivo;
- no mostrar éxito;
- permitir actualizar estado;
- permitir acción de reconciliación solo mediante API segura definida por backend.

No ofrecer botón:

`Intentar de nuevo`

si eso genera un nuevo submit.

---

# 28. FAILED

Cuando backend confirme fallo:

mostrar explicación clara.

Texto base:

`No fue posible timbrar el CFDI. Revisa la información indicada antes de intentarlo nuevamente.`

Si existe código técnico útil:

puede mostrarse de forma secundaria.

No mostrar:

- secretos;
- headers;
- stack traces;
- respuesta PAC cruda;
- credenciales.

Un FAILED corregible puede permitir nuevo intento únicamente cuando backend lo habilite.

---

# 29. ISSUED

Únicamente cuando backend devuelva estado real:

`ISSUED`

mostrar:

`✓ CFDI timbrado correctamente`

Puede incluir:

- UUID;
- fecha de timbrado;
- PAC;
- total;
- XML;
- PDF.

No construir UUID desde frontend.

No convertir READY en ISSUED localmente.

No usar optimismo de UI para este cambio.

---

# 30. Descarga de XML y PDF

Los botones de descarga deben utilizar las rutas privadas proporcionadas por backend.

No construir URLs de almacenamiento manualmente.

No guardar documentos fiscales en frontend.

Botones:

`Descargar XML`

`Descargar PDF`

Si PDF aún no está disponible pero XML sí:

mostrar el CFDI como emitido y permitir que PDF se regenere.

No provocar nuevo timbrado por ausencia de PDF.

---

# 31. Inmutabilidad visual de ISSUED

Después de ISSUED:

la factura se presenta en modo lectura.

No permitir editar:

- emisor;
- receptor;
- conceptos;
- impuestos;
- subtotal;
- total;
- régimen;
- Uso CFDI.

No mostrar botón de guardar cambios fiscales.

Correcciones posteriores pertenecen a flujos futuros.

---

# 32. Sandbox

Cuando el backend indique ambiente:

`SANDBOX`

mostrar una identificación visual clara.

Ejemplo:

`Prueba · Sandbox`

No presentar sandbox como factura fiscal válida.

No mezclar visualmente con emisiones productivas.

No usar mensajes:

`Factura emitida correctamente`

sin indicar el entorno cuando se trate de sandbox.

---

# 33. Sidebar desktop

Implementar el comportamiento solicitado sin rediseñar todo el sidebar.

Cuando el sidebar está expandido:

contraer automáticamente cuando:

- el usuario navega a una opción;
- el usuario hace clic fuera.

No contraer mientras el usuario interactúa con:

- acordeones internos;
- botones internos;
- controles necesarios;

salvo que la acción provoque navegación.

Mantener navegación por teclado.

---

# 34. Altura del sidebar

El sidebar no debe ocultar:

- banner de cookies;
- controles de privacidad;
- elementos inferiores importantes.

No resolverlo con un valor fijo que funcione únicamente en una pantalla.

Usar comportamiento responsive basado en viewport.

Probar como mínimo:

- 1440 px;
- 1280 px;
- 820 px;
- 390 px;
- 360 px.

---

# 35. Banner de cookies

El banner debe permanecer:

- visible;
- legible;
- clickeable;
- encima de elementos que puedan interferir.

Sidebar y banner no deben bloquearse entre sí.

Revisar:

- z-index;
- stacking context;
- fixed/sticky;
- viewport height;
- mobile.

No cambiar el contenido legal del banner sin autorización.

---

# 36. Topbar glass

Aplicar efecto glass funcional a la barra superior.

Puede utilizar:

- fondo semitransparente;
- backdrop blur;
- borde sutil;
- sombra ligera.

Debe conservar legibilidad durante scroll.

No exagerar el blur.

Deben seguir siendo legibles:

- breadcrumb;
- título;
- botones;
- controles.

No convertir esto en rediseño global.

---

# 37. Responsive

Todos los nuevos flujos deben funcionar correctamente en:

- desktop;
- tablet;
- mobile.

Evitar:

- overflow horizontal;
- modales fuera de viewport;
- botones inaccesibles;
- formularios demasiado anchos;
- tablas imposibles de usar;
- overlays bloqueando controles.

En mobile:

priorizar lectura, jerarquía y acciones claras.

---

# 38. Accesibilidad

Mantener o mejorar:

- labels;
- focus visible;
- navegación por teclado;
- ARIA;
- mensajes asociados a campos;
- contraste;
- tamaño táctil;
- Escape en overlays cuando corresponda;
- prefers-reduced-motion.

Estados de error no deben depender únicamente del color.

Estados fiscales importantes deben tener:

- texto;
- icono o señal complementaria;
- semántica accesible.

---

# 39. Loading states

Toda operación asíncrona nueva debe tener estado visible.

Especialmente:

- CSF upload;
- extracción;
- catálogos;
- confirmación;
- CSD upload;
- validación CSD;
- preparación de CFDI;
- timbrado;
- reconciliación;
- descarga.

No utilizar loaders que bloqueen toda la aplicación si no es necesario.

No mantener botones activos durante operaciones críticas.

---

# 40. Error handling

Frontend debe manejar errores server-side sin reinterpretarlos como éxito.

Cuando backend entregue error normalizado:

mostrar mensaje correspondiente.

Cuando exista error inesperado:

usar mensaje genérico seguro.

Ejemplo:

`No pudimos completar esta operación. Inténtalo nuevamente o consulta el detalle disponible.`

No imprimir objetos completos de error al usuario.

---

# 41. Estado cliente

No guardar material fiscal sensible innecesariamente en:

- localStorage;
- sessionStorage;
- IndexedDB;
- query string;
- URL;
- analytics;
- logs del navegador.

No persistir:

- contraseña CSD;
- `.key`;
- XML completo;
- secretos;
- tokens PAC.

Mantener solo el estado estrictamente necesario para la UX.

---

# 42. APIs y contratos

Codex consume las APIs implementadas por Claude/backend.

No inventar respuestas que no existan.

Mientras backend no esté integrado:

puede construir componentes contra tipos/fixtures explícitamente locales para desarrollo visual.

Pero:

- ningún fixture debe activar ISSUED productivo;
- ningún mock debe presentarse como backend real;
- los mocks deben quedar claramente aislados;
- deben retirarse o reemplazarse durante integración.

---

# 43. Ownership con Claude

Codex puede modificar principalmente:

- páginas;
- componentes;
- hooks de UI;
- formularios;
- estilos;
- tests frontend;
- accesibilidad;
- responsive;
- navegación.

Claude tiene ownership principal de:

- Prisma;
- migraciones;
- criptografía;
- CSD backend;
- XML;
- XSD;
- XSLT;
- firma;
- PacProvider;
- SW;
- StampAttempt;
- idempotencia;
- persistencia fiscal.

Codex NO debe modificar esas áreas sin coordinación.

---

# 44. Archivos compartidos

Si Codex necesita cambiar:

- tipos compartidos;
- contrato API;
- enums;
- modelos;
- archivos que Claude también necesita;

debe detenerse antes de modificar.

Documentar:

1. archivo;
2. cambio requerido;
3. motivo;
4. impacto.

No resolver conflictos arquitectónicos modificando silenciosamente el archivo compartido.

---

# 45. Prisma y migraciones

Codex NO tiene ownership de migraciones en Fase 5C.

No modificar:

`prisma/schema.prisma`

salvo instrucción expresa.

No ejecutar migraciones.

No ejecutar:

`prisma migrate deploy`

No tocar Neon producción.

Si una necesidad visual requiere un nuevo campo backend:

reportarlo.

Claude/backend lo implementa.

---

# 46. Datos ficticios

Fixtures pueden utilizarse únicamente para:

- pruebas;
- Story-like development si existe;
- visualización temporal;
- tests automatizados.

Nunca usar datos ficticios para:

- marcar ISSUED;
- generar UUID real aparente;
- simular PAC productivo;
- ocultar API faltante.

Visualmente deben distinguirse los contextos de prueba cuando sea necesario.

---

# 47. Tests de Perfil Fiscal

Cubrir como mínimo:

- carga PDF;
- consentimiento desmarcado;
- procesamiento bloqueado sin consentimiento;
- loading;
- extracción exitosa;
- extracción parcial;
- múltiples regímenes;
- error;
- captura manual;
- confirmación;
- mensaje de guardado.

---

# 48. Tests de Clientes

Cubrir:

- creación manual;
- régimen por catálogo;
- Uso CFDI;
- CSF opcional;
- consentimiento;
- extracción;
- revisión;
- comparación contra datos existentes;
- fallo de extracción;
- guardado correcto.

No probar como requisito que CSF sea obligatoria.

---

# 49. Tests de CSD UI

Cubrir:

- selección `.cer`;
- selección `.key`;
- contraseña;
- loading;
- válido;
- inválido;
- vencido;
- contraseña incorrecta;
- archivos incompatibles;
- mensaje seguro;
- contraseña no persistida.

No usar material productivo real.

---

# 50. Tests de timbrado UI

Cubrir:

- READY;
- autorización desmarcada;
- botón deshabilitado;
- SIGNING;
- SUBMITTING;
- WAITING_PROVIDER;
- SUCCEEDED/ISSUED;
- FAILED;
- UNKNOWN;
- reconciliación;
- doble clic;
- refresh;
- edición bloqueada;
- sandbox visible;
- descarga XML;
- descarga PDF.

No depender únicamente de snapshots visuales.

Verificar comportamiento.

---

# 51. Responsive tests

Probar como mínimo:

- 1440 px;
- 1280 px;
- 820 px;
- 390 px;
- 360 px.

Revisar específicamente:

- sidebar;
- topbar;
- cookies;
- formularios;
- dropdowns;
- modales;
- revisión final;
- estados de timbrado;
- botones de descarga.

No aceptar overflow horizontal no intencional.

---

# 52. Regresión

Antes de entregar:

ejecutar las validaciones existentes aplicables.

Como mínimo cuando el entorno lo permita:

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run security:check
git diff --check
```

También ejecutar:

- E2E de Invoice Studio;
- Fase 5C frontend;
- pruebas responsive;
- accesibilidad afectada.

No ocultar flakes ni tests fallidos.

---

# 53. No degradar funcionalidades anteriores

Fase 5C no puede romper:

- Dashboard;
- Empresas;
- Perfil Fiscal existente;
- Clientes;
- Tickets;
- Gastos;
- CFDI recibidos;
- Fase 4;
- Fase 5A;
- Fase 5B;
- autenticación;
- planes;
- navegación mobile.

Si un cambio rompe funcionalidad previa:

corregir antes de entregar.

---

# 54. Plan gating

Mantener las reglas existentes de planes.

Frontend puede ocultar o deshabilitar según entitlement.

Backend sigue siendo autoridad.

No habilitar timbrado únicamente cambiando React.

No eliminar gating existente de PRO/MAX sin autorización.

---

# 55. No duplicar reglas fiscales

No implementar un segundo motor de validación completo dentro del navegador.

Puede existir validación UX básica.

Las reglas fiscales definitivas viven en backend.

Cuando backend rechace una combinación:

mostrar el error.

No intentar "corregir" silenciosamente la respuesta.

---

# 56. Privacidad

La UI debe dejar claro cuándo se procesa información fiscal.

No utilizar datos de:

- CSF;
- Clientes;
- CSD;
- CFDI;

para analytics de contenido sensible.

Si existe analytics global:

asegurar que no capture automáticamente valores de formularios fiscales.

No enviar documentos o datos fiscales a herramientas externas no aprobadas.

---

# 57. Textos fiscales

No modificar arbitrariamente textos de:

- consentimiento;
- autorización;
- privacidad;
- timbrado;
- datos de terceros.

Usar los textos establecidos por:

`FASE5C-CONTRACT.md`

Si el diseño necesita versión corta:

mantener el texto completo disponible y no cambiar su significado.

---

# 58. Producción

Codex NO debe:

- activar PAC productivo;
- subir credenciales;
- timbrar una factura real;
- usar CSD real;
- hacer deploy;
- modificar Vercel producción;
- modificar Neon producción.

El rollout productivo pertenece a la etapa de integración controlada.

---

# 59. Entrega de Codex

Al terminar, Codex debe entregar un resumen estructurado con:

## Implementado

Qué flujos quedaron funcionando.

## Pantallas modificadas

Lista de páginas y componentes.

## Integraciones

Qué APIs reales están conectadas.

## Mocks pendientes

Cualquier fixture o mock que todavía exista.

## Responsive

Resoluciones probadas.

## Accesibilidad

Validaciones realizadas.

## Tests

Comandos y resultados.

## Pendiente

Dependencias del backend o decisiones humanas.

## Riesgos

Cualquier problema detectado en UX, seguridad, privacidad o integración.

---

# 60. Prohibiciones expresas

Codex NO debe:

- implementar criptografía;
- firmar XML;
- construir sello CFDI;
- implementar PacProvider;
- inventar endpoints de SW;
- crear UUID;
- convertir mock en ISSUED;
- guardar contraseña CSD;
- guardar `.key` en navegador;
- guardar secretos PAC;
- tocar producción;
- ejecutar migraciones productivas;
- rediseñar toda la aplicación;
- cambiar el contrato silenciosamente;
- ampliar alcance fiscal sin autorización.

---

# 61. Criterio final

La experiencia debe permitir que el usuario comprenda claramente:

- qué información está proporcionando;
- qué información fue detectada;
- qué información confirmó;
- cuándo un dato todavía requiere revisión;
- qué CSD está configurado;
- cuándo una factura está únicamente READY;
- cuándo está siendo procesada;
- cuándo existe incertidumbre;
- cuándo el PAC realmente la timbró;
- dónde descargar XML y PDF.

Nunca utilizar diseño para ocultar incertidumbre fiscal.

Ante un estado desconocido:

`NO SIMULAR ÉXITO`

Ante una respuesta incompleta:

`MOSTRAR ESTADO REAL`

Ante cualquier conflicto entre apariencia y seguridad:

`PRIORIZAR SEGURIDAD`
