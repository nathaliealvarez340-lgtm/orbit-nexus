# ORBIT NEXUS - CLAUDE FASE 5C



## Rol



Claude trabaja exclusivamente en:



`Fase 5C-A · Fiscal Identity + PAC Foundation`



Su responsabilidad principal es backend, dominio fiscal, seguridad, criptografía, persistencia, PAC e infraestructura de emisión.



Claude NO es responsable del rediseño visual de ORBIT.



---



# 1. Lectura obligatoria antes de modificar código



Antes de implementar cualquier cambio, leer completamente:



- `AGENTS.md`

- `CLAUDE.md`

- `docs/ARCHITECTURE.md`

- `docs/PRODUCT.md`

- `docs/WORKTREE-RULES.md`

- `docs/tasks/FASE5C-CONTRACT.md`



También revisar las implementaciones existentes de:



- Fase 3;

- Fase 4;

- Fase 5A;

- Fase 5B.



No asumir que una ruta, modelo o servicio funciona de cierta manera sin verificarlo en el repositorio.



Si el trabajo toca comportamiento específico de Next.js, leer primero la documentación correspondiente disponible en:



`node_modules/next/dist/docs/`



según las reglas de `AGENTS.md`.



---



# 2. Regla principal



`docs/tasks/FASE5C-CONTRACT.md`



es la fuente de verdad de Fase 5C.



Claude NO puede modificar silenciosamente:



- estados;

- contratos;

- rutas compartidas;

- reglas fiscales;

- ownership;

- semántica de READY;

- semántica de ISSUED;

- consentimiento;

- seguridad del CSD;

- PacProvider;

- idempotencia;

- manejo de UNKNOWN.



Si considera necesario cambiar el contrato:



1. detener implementación;

2. documentar el problema;

3. explicar el cambio requerido;

4. esperar decisión humana.



No alterar el contrato para adaptar la implementación.



La implementación se adapta al contrato.



---



# 3. Entorno de trabajo



Claude trabaja únicamente en su worktree asignado.



NO trabajar en:



`main`



NO modificar directamente el worktree de Codex.



NO hacer:



- merge a main;

- force push;

- deploy;

- cambios en Neon producción;

- migraciones sobre producción;

- configuración de Vercel producción;

- operaciones destructivas externas.



Los cambios quedan preparados en la rama de Claude para revisión e integración posterior.



No realizar commits salvo instrucción expresa.



---



# 4. Objetivo general



Implementar la infraestructura backend necesaria para evolucionar una factura desde:



`READY`



hasta:



`ISSUED`



únicamente cuando exista evidencia válida de timbrado real mediante un PAC.



Fase 5C-A incluye:



- identidad fiscal;

- CSF;

- consentimiento;

- catálogos;

- CSD;

- cifrado;

- CFDI 4.0;

- cadena original;

- sello;

- PacProvider;

- SW sandbox;

- StampAttempt;

- idempotencia;

- reconciliación;

- persistencia fiscal;

- APIs;

- auditoría;

- seguridad;

- pruebas.



Producción real permanece deshabilitada hasta completar los gates definidos en el contrato.



---



# 5. Trabajo previo obligatorio



Antes de escribir código:



## 5.1 Inspeccionar el dominio existente



Identificar:



- modelos Prisma relacionados con factura;

- InvoiceStatus;

- InvoiceSettings;

- StampedInvoice;

- StampedInvoiceConcept;

- SavedInvoiceConcept;

- Perfil Fiscal;

- Clientes;

- ActivityLog;

- Subscription;

- Organization;

- Membership;

- almacenamiento privado existente;

- rutas server-side;

- servicios de autorización;

- servicios de seguridad;

- utilidades Decimal;

- validaciones de Fase 5A;

- Invoice Studio de Fase 5B.



No duplicar servicios ya existentes si pueden ampliarse correctamente.



## 5.2 Confirmar aislamiento tenant



Toda operación debe partir de:



- sesión válida;

- Membership válida;

- Organization autorizada.



Nunca confiar únicamente en:



`organizationId`



recibido desde navegador.



## 5.3 Revisar migraciones existentes



No romper:



- Fase 3;

- Fase 4;

- Fase 5A;

- Fase 5B.



Las nuevas migraciones deben ser:



- aditivas cuando sea posible;

- revisables;

- reversibles conceptualmente;

- no destructivas sin autorización.



---



# 6. Módulo de documentos fiscales



Implementar infraestructura backend para Constancia de Situación Fiscal.



Debe existir separación conceptual entre:



1. documento original;

2. resultado detectado;

3. información confirmada.



Nunca utilizar directamente el resultado de extracción como dato fiscal definitivo.



## 6.1 Consentimiento



No procesar la CSF para autocompletado antes de consentimiento explícito.



Registrar como mínimo:



- organizationId;

- userId;

- documentId;

- purpose;

- consentVersion;

- acceptedAt.



Purposes iniciales:



- `FISCAL_PROFILE_PREFILL`

- `CLIENT_FISCAL_PREFILL`



No registrar secretos.



## 6.2 Parser



El parser puede detectar cuando estén disponibles:



- RFC;

- nombre;

- razón social;

- tipo de persona;

- código postal;

- domicilio;

- régimen;

- múltiples regímenes;

- otros datos expresamente definidos.



NO inferir:



- Uso CFDI;

- forma de pago;

- método de pago;

- correo;

- moneda;

- información ausente.



Debe soportar estados equivalentes a:



- `DETECTED`

- `LOW_CONFIDENCE`

- `AMBIGUOUS`

- `NOT_FOUND`



Información de baja confianza nunca se convierte automáticamente en confirmada.



## 6.3 Fallos



Si el parser falla:



- no inventar datos;

- no bloquear captura manual;

- no marcar perfil como validado;

- devolver resultado seguro y entendible.



---



# 7. Catálogos fiscales



Backend es autoridad para catálogos fiscales.



Implementar o reforzar catálogo de:



- régimen fiscal;

- Uso CFDI;

- demás catálogos necesarios para CFDI soportado.



La UI mostrará:



`Código · Descripción`



pero backend persiste y valida códigos.



No hardcodear catálogos completos dentro de componentes React.



## 7.1 Reglas



Validar cuando corresponda:



- existencia;

- vigencia;

- tipo de persona;

- compatibilidad;

- reglas fiscales soportadas.



Si ORBIT no puede verificar un dato fiscal relevante:



no permitir `READY`.



## 7.2 Fuentes



Los catálogos deben derivarse de fuentes fiscales oficiales o recursos versionados y verificables.



No asumir que los catálogos existentes son completos.



Si existe un catálogo parcial:



mantener señal equivalente a:



`complete: false`



o una semántica que impida tratarlo como completo.



---



# 8. Datos maestros y snapshots



Perfil Fiscal y Cliente son datos maestros.



Las facturas deben utilizar snapshots.



Claude debe garantizar que:



- cambiar Cliente no modifica facturas históricas;

- cambiar Perfil Fiscal no modifica facturas históricas;

- READY que cambia datos fiscales vuelve a DRAFT;

- ISSUED es inmutable;

- XML emitido nunca se reconstruye sustituyendo datos históricos.



No eliminar snapshots existentes de Fase 5A/5B.



---



# 9. CSD



Implementar backend seguro para Certificado de Sello Digital.



El flujo utiliza:



- `.cer`;

- `.key`;

- contraseña de llave privada.



NO utilizar e.firma.



## 9.1 Validaciones mínimas



Backend debe validar:



- formato del certificado;

- formato de llave;

- contraseña;

- correspondencia certificado/llave;

- vigencia;

- RFC cuando pueda verificarse;

- compatibilidad con Organization/emisor;

- límites de archivo;

- contenido real, no únicamente extensión.



## 9.2 Estados



Soportar semántica equivalente a:



- `NOT_CONFIGURED`

- `VALIDATING`

- `VALID`

- `INVALID`

- `EXPIRED`



Solo `VALID` puede utilizarse para timbrado.



## 9.3 Contraseña



La contraseña:



- no se persiste permanentemente en esta fase;

- no se registra;

- no se devuelve;

- no se agrega a ActivityLog;

- no se incorpora a errores;

- se descarta después de la operación.



No diseñar automatización que requiera guardar silenciosamente esta contraseña.



---



# 10. Custodia y cifrado



La llave privada del CSD debe almacenarse cifrada.



No utilizar como "cifrado":



- base64;

- ofuscación;

- extensión distinta;

- JSON escondido.



## 10.1 Requisitos



El diseño debe proporcionar:



- cifrado autenticado;

- aislamiento por Organization;

- versionado de clave cuando corresponda;

- clave maestra fuera de la fila de Prisma;

- no exposición al navegador;

- no URL pública;

- no Git;

- no logs.



Preferir un diseño compatible con envelope encryption / secret management.



Si la infraestructura actual no dispone de KMS, diseñar una abstracción que permita migrar a KMS sin reescribir el dominio.



No inventar una solución criptográfica propia.



Utilizar primitivas estándar mantenidas.



## 10.2 Fail closed



Ante duda sobre:



- descifrado;

- integridad;

- contraseña;

- RFC;

- vigencia;

- autorización;



resultado:



`NO TIMBRAR`



---



# 11. Recursos oficiales CFDI



La implementación debe usar recursos técnicos oficiales aplicables a CFDI 4.0.



Como mínimo:



- XSD;

- XSLT de cadena original;

- catálogos;

- reglas necesarias;

- metadata de versión.



No descargar estos archivos desde SAT en cada factura.



Los recursos deben estar:



- versionados;

- identificados;

- auditables;

- probados.



No actualizar silenciosamente recursos fiscales en producción.



---



# 12. Alcance CFDI inicial



Fase 5C soporta inicialmente:



`CFDI 4.0`



Tipo:



`I · Ingreso`



No declarar soporte para:



- Egreso;

- Traslado;

- Nómina;

- Complemento de Pago;

- Carta Porte;

- Comercio Exterior;

- otros complementos;



hasta que existan implementaciones específicas.



---



# 13. Construcción del XML



El XML se construye server-side.



Nunca aceptar desde frontend como autoridad:



- subtotal;

- total;

- impuestos;

- descuentos;

- RFC;

- sello;

- UUID;

- certificado;

- estado fiscal.



Utilizar:



- Decimal;

- snapshots;

- reglas backend;

- recursos fiscales versionados.



Evitar:



- floating point;

- locale;

- timezone del navegador;

- serialización no determinística.



## 13.1 Antes de firma



Secuencia obligatoria:



1. cargar draft autorizado;

2. revalidar estado READY;

3. verificar versión;

4. construir XML;

5. validar estructura;

6. validar reglas fiscales;

7. validar XSD;

8. generar cadena original;

9. firmar;

10. verificar firma local;

11. únicamente entonces enviar al PAC.



Si falla cualquier paso:



`NO ENVIAR AL PAC`



---



# 14. Cadena original y sello



No construir la cadena original mediante concatenación manual inventada.



Utilizar XSLT oficial correspondiente.



Para el estándar soportado:



- SHA-256;

- RSA;

- llave privada del CSD.



Utilizar librerías criptográficas estándar.



Antes de enviar:



verificar localmente que el sello corresponde al certificado y al XML.



---



# 15. PacProvider



Crear una abstracción desacoplada equivalente a:



```ts

export interface PacProvider {

  stamp(input: PacStampInput): Promise<PacStampResult>;



  reconcile?(input: PacReconcileInput): Promise<PacStampResult>;

}

```



El dominio NO puede depender directamente de SW.



## 15.1 Responsabilidad del adaptador



El adaptador específico maneja:



- autenticación;

- URL;

- headers;

- payload;

- timeout;

- errores;

- respuesta;

- reconciliación;

- providerReference.



El dominio recibe resultados normalizados.



## 15.2 Resultado normalizado



Semántica mínima:



- `STAMPED`

- `REJECTED`

- `UNKNOWN`



HTTP 200 NO equivale a STAMPED.



---



# 16. PAC inicial



Proveedor inicial:



`SW sapien / SmarterWEB`



Antes de implementar el adaptador:



- localizar documentación técnica vigente;

- verificar formato actual;

- verificar autenticación;

- verificar endpoints sandbox;

- verificar mecanismos de consulta/reconciliación;

- verificar límites y respuestas.



NO inventar endpoints.



NO copiar integraciones antiguas de internet sin contrastarlas con documentación vigente.



NO usar credenciales productivas.



Trabajar inicialmente únicamente con:



`SANDBOX`



---



# 17. StampAttempt



Crear infraestructura durable para intentos PAC.



Cada intento debe relacionarse con:



- Organization;

- invoice;

- actor;

- draftVersion;

- idempotencyKey;

- provider;

- environment;

- timestamps;

- status;

- providerReference cuando exista.



Estados equivalentes:



- `PENDING`

- `SIGNING`

- `SUBMITTING`

- `WAITING_PROVIDER`

- `SUCCEEDED`

- `FAILED`

- `UNKNOWN`



No cambiar `InvoiceStatus` silenciosamente.



---



# 18. Idempotencia



La emisión debe resistir:



- doble clic;

- refresh;

- retry HTTP;

- dos pestañas;

- worker repetido;

- timeout.



La idempotencyKey:



- se genera server-side;

- está ligada a Organization/invoice/version;

- no permite cross-tenant;

- debe ser estable para el intento.



No permitir múltiples intentos activos incompatibles.



Utilizar garantía de base de datos cuando sea posible.



No confiar únicamente en estado de React.



---



# 19. UNKNOWN



`UNKNOWN` es un estado crítico.



Se utiliza cuando ORBIT no puede demostrar si el PAC timbró.



Ejemplos:



- timeout posterior a submit;

- conexión cortada;

- respuesta corrupta;

- estado remoto incierto.



Ante UNKNOWN:



- no marcar FAILED automáticamente;

- no crear nuevo intento;

- no repetir submit ciegamente;

- reconciliar primero.



Si el PAC permite consulta:



utilizarla.



Si se recupera XML timbrado válido:



finalizar el intento existente.



---



# 20. Validación de respuesta PAC



Nunca confiar solo en:



- HTTP 200;

- `success: true`;

- UUID en JSON;

- providerReference.



Para pasar a ISSUED debe existir XML timbrado válido.



Validar como mínimo:



- XML parseable;

- CFDI esperado;

- Timbre Fiscal Digital;

- UUID;

- fecha de timbrado;

- sello CFDI;

- sello SAT;

- certificado SAT;

- RFC emisor;

- RFC receptor;

- total;

- moneda;

- consistencia con XML enviado.



El UUID se obtiene del Timbre Fiscal Digital.



Nunca generarlo localmente.



---



# 21. READY -> ISSUED



ISSUED se asigna únicamente después de validar evidencia real del PAC.



Persistir:



- UUID;

- XML timbrado;

- fecha de timbrado;

- proveedor;

- ambiente;

- attempt;

- hashes;

- metadata segura;

- auditoría.



La persistencia final debe ser consistente/transaccional en la medida posible.



No poner ISSUED y después "intentar guardar" el XML.



La evidencia fiscal debe quedar vinculada al cambio de estado.



---



# 22. XML y PDF



El XML timbrado es la evidencia principal.



Debe almacenarse privado.



Nunca:



- `/public`;

- URL pública permanente;

- asset estático;

- bucket público.



Registrar hash de integridad.



El PDF:



- se genera a partir del CFDI timbrado;

- puede regenerarse;

- no es autoridad superior al XML.



Si PDF falla después de timbrado:



la factura sigue siendo ISSUED.



Nunca re-timbrar por fallo de PDF.



---



# 23. Auditoría



Registrar eventos fiscales relevantes mediante ActivityLog o infraestructura equivalente.



Ejemplos:



- `CSD_CONFIGURED`

- `CSD_REPLACED`

- `CSD_VALIDATION_FAILED`

- `CFDI_READY`

- `STAMP_REQUESTED`

- `STAMP_SIGNED`

- `STAMP_SUBMITTED`

- `STAMP_REJECTED`

- `STAMP_UNKNOWN`

- `STAMP_RECONCILED`

- `CFDI_ISSUED`

- `PDF_GENERATED`



Nunca registrar:



- contraseña;

- `.key`;

- secretos PAC;

- Authorization headers;

- claves de cifrado;

- XML completo en ActivityLog.



---



# 24. Seguridad de red



Requests al PAC:



- HTTPS obligatorio;

- TLS válido;

- timeout explícito;

- hosts allowlisted/configurados;

- redirects restringidos;

- límites de tamaño;

- sanitización de errores.



No permitir URLs PAC controladas por usuario.



Proteger contra SSRF.



No deshabilitar TLS para resolver problemas locales.



---



# 25. APIs



Diseñar APIs siguiendo la arquitectura existente.



Deben incluir autorización server-side y aislamiento tenant.



Rutas conceptuales pueden cubrir:



- carga CSF;

- consentimiento;

- extracción;

- confirmación fiscal;

- catálogos;

- carga CSD;

- validación CSD;

- estado CSD;

- inicio de timbrado;

- estado de intento;

- reconciliación;

- descarga XML;

- descarga PDF.



Los nombres exactos deben respetar convenciones existentes.



No inventar una segunda arquitectura de API paralela.



---



# 26. Ownership y límites con Codex



Claude puede modificar:



- Prisma;

- migraciones;

- servicios backend;

- tipos fiscales backend;

- APIs;

- seguridad;

- tests;

- infraestructura compartida acordada.



Claude NO debe rediseñar:



- Perfil Fiscal;

- Clientes;

- Invoice Studio;

- sidebar;

- topbar;

- componentes visuales.



Si Codex necesita un contrato server-side:



definir el tipo/API de forma estable.



Evitar modificar archivos visuales salvo que sea estrictamente necesario para compilar y esté justificado.



---



# 27. Migraciones



Si Fase 5C requiere Prisma:



1. modificar schema;

2. generar migración local;

3. revisar SQL;

4. ejecutar únicamente contra entorno local de desarrollo;

5. verificar que sea no destructiva;

6. ejecutar tests.



NO aplicar migración en Neon producción.



NO ejecutar:



`prisma migrate deploy`



contra producción.



La aplicación productiva de migraciones se realizará posteriormente durante integración humana.



---



# 28. Tests mínimos



Crear tests para:



## CSF



- consentimiento requerido;

- PDF válido;

- PDF inválido;

- múltiples regímenes;

- baja confianza;

- dato ausente;

- aislamiento tenant;

- actualización contra datos confirmados.



## CSD



- certificado válido de prueba;

- contraseña correcta;

- contraseña incorrecta;

- llave incorrecta;

- certificado vencido;

- RFC incompatible;

- cross-tenant;

- secretos ausentes de errores/logs.



## CFDI



- XML válido;

- XSD;

- cadena original;

- sello verificable;

- Decimal;

- impuestos;

- descuentos;

- retenciones;

- snapshots;

- cambio posterior a READY bloqueado.



## PAC



- STAMPED;

- REJECTED;

- UNKNOWN;

- timeout;

- response corrupta;

- XML sin TFD;

- UUID inconsistente;

- RFC inconsistente;

- total inconsistente;

- reintento;

- doble submit;

- reconciliación.



## Seguridad



- autorización;

- tenant isolation;

- rate limiting;

- SSRF;

- body limits;

- sanitización.



---



# 29. Validación antes de entregar



Antes de declarar terminado su trabajo, ejecutar como mínimo lo aplicable a la rama:



```text

npm run db:generate

npm run lint

npm run typecheck

npm test

npm run build

npm run security:check

git diff --check

```



También ejecutar suites E2E afectadas cuando el entorno local lo permita.



No ocultar:



- tests fallidos;

- flakes;

- warnings relevantes;

- deuda técnica;

- funcionalidades incompletas.



---



# 30. Entrega de Claude



Al terminar, Claude debe entregar un resumen estructurado con:



## Implementado



Qué quedó funcionando.



## Archivos principales



Archivos creados/modificados.



## Migraciones



Nombre de migración y descripción.



## APIs



Rutas o acciones creadas.



## Seguridad



Decisiones de cifrado, tenant isolation y secretos.



## PAC



Qué parte de SW sandbox está realmente conectada.



## Tests



Comandos ejecutados y resultados.



## Pendiente



Todo aquello que:



- depende de credenciales;

- depende del PAC;

- depende de producción;

- requiere decisión;

- no pudo verificarse.



## Riesgos



Cualquier riesgo fiscal, criptográfico, de privacidad o concurrencia detectado.



---



# 31. Prohibiciones expresas



Claude NO debe:



- emitir CFDI productivo;

- usar CSD real;

- usar e.firma;

- inventar UUID;

- simular ISSUED;

- guardar contraseña CSD;

- guardar secretos PAC en Prisma;

- guardar secretos en Git;

- usar Neon producción;

- cambiar Vercel producción;

- hacer deploy;

- hacer merge a main;

- modificar silenciosamente el contrato;

- implementar cancelación;

- implementar complemento de pago;

- ampliar alcance fiscal sin autorización.



---



# 32. Criterio final



La prioridad no es conseguir que el botón "funcione".



La prioridad es que ORBIT pueda demostrar:



- qué información utilizó;

- quién la confirmó;

- qué certificado utilizó;

- qué XML firmó;

- qué request envió;

- qué respondió el PAC;

- por qué una factura pasó a ISSUED;

- que ningún retry generó un segundo CFDI;

- que ningún tenant pudo acceder al material de otro;

- que ningún secreto quedó expuesto.



Ante cualquier duda fiscal, criptográfica o de autorización:



`FAIL CLOSED`



y:



`NO TIMBRAR`
