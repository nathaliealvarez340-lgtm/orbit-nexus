# ORBIT NEXUS - FASE 5C CONTRATO COMPARTIDO



Este documento define el contrato obligatorio de Fase 5C.



Fase 5C agrega emisión fiscal real sobre la base construida en Fase 5A y 5B.



La prioridad es:



1. cumplimiento fiscal;

2. seguridad;

3. protección del usuario;

4. trazabilidad;

5. idempotencia;

6. experiencia clara;

7. independencia del PAC.



Ningún agente puede modificar silenciosamente este contrato.



---



# 1. Objetivo



Implementar la infraestructura necesaria para que ORBIT pueda evolucionar desde:



`READY`



hasta:



`ISSUED`



únicamente después de un timbrado real y verificable mediante un Proveedor Autorizado de Certificación vigente ante el SAT.



Fase 5C también incluye:



- mejora del perfil fiscal;

- lectura autorizada de Constancia de Situación Fiscal;

- autocompletado fiscal;

- catálogos fiscales visibles con código y descripción;

- mejora del alta/edición de clientes;

- infraestructura segura para CSD;

- arquitectura PAC desacoplada;

- sandbox PAC;

- preparación de XML CFDI 4.0;

- firma/sellado;

- persistencia de XML timbrado real;

- ajustes funcionales de navegación necesarios.



No se permite simular timbrado.



---



# 2. ORBIT no es PAC



ORBIT NEXUS es una plataforma tecnológica.



ORBIT NO debe presentarse ni operar como Proveedor Autorizado de Certificación.



La certificación/timbrado de CFDI será realizada por un PAC vigente autorizado por el SAT.



El PAC inicial seleccionado para integración es:



`SW sapien / SmarterWEB`



La arquitectura debe utilizar una abstracción equivalente a:



```ts

export interface PacProvider {

  stamp(input: PacStampInput): Promise<PacStampResult>;

}



```



La lógica de negocio no puede depender directamente de un único proveedor.



Debe ser posible incorporar otro PAC sin reconstruir Invoice Studio ni el dominio fiscal.



---



# 3. Regla fundamental de emisión



`READY` significa:



El borrador pasó las validaciones fiscales soportadas por ORBIT y puede intentar timbrarse.



`ISSUED` significa exclusivamente:



El PAC devolvió evidencia válida de un CFDI realmente timbrado.



Nunca cambiar a `ISSUED` únicamente por:



- HTTP 200;

- respuesta JSON exitosa sin CFDI;

- UUID generado localmente;

- XML sin Timbre Fiscal Digital;

- mock;

- sandbox presentado como producción.



Para pasar a `ISSUED` deben existir como mínimo:



- UUID real;

- XML timbrado;

- Timbre Fiscal Digital;

- datos consistentes con el borrador enviado;

- respuesta PAC validada.



---



# 4. Estados



Se conservan los estados existentes:



- `DRAFT`

- `READY`

- `ISSUED`

- `CANCELLED`

- `ERROR`



Fase 5C puede introducir estados operativos internos para intentos PAC, pero no debe alterar silenciosamente `InvoiceStatus`.



Un intento de timbrado puede tener estados equivalentes a:



- `PENDING`

- `SIGNING`

- `SUBMITTING`

- `WAITING_PROVIDER`

- `SUCCEEDED`

- `FAILED`

- `UNKNOWN`



`UNKNOWN` se utiliza cuando la respuesta es ambigua y existe riesgo de que el PAC haya timbrado.



Un intento `UNKNOWN` NO se reintenta automáticamente.



Primero debe consultarse al PAC o reconciliarse por idempotencia.



---



# 5. e.firma y CSD



ORBIT nunca solicitará, almacenará ni utilizará la e.firma del usuario para emitir CFDI.



Para emisión se utilizará exclusivamente el Certificado de Sello Digital del contribuyente:



- archivo `.cer`;

- archivo `.key`;

- contraseña de la llave privada.



La contraseña del CSD:



- no se guarda en texto plano;

- no se registra en logs;

- no se devuelve al frontend;

- no forma parte de ActivityLog;

- no se almacena permanentemente en esta primera implementación.



La llave privada:



- debe almacenarse cifrada;

- debe estar aislada por Organization;

- nunca puede exponerse mediante una URL pública;

- nunca puede incluirse en logs;

- nunca puede llegar a Git.



Los secretos PAC tampoco se guardan en Prisma.



---



# 6. Constancia de Situación Fiscal del emisor



En Perfil Fiscal, la carga de Constancia de Situación Fiscal debe aparecer ANTES del formulario manual.



Flujo:



1. usuario sube PDF;

2. ORBIT muestra autorización;

3. archivo NO se procesa hasta aceptar;

4. usuario marca autorización;

5. ORBIT procesa el documento;

6. ORBIT autocompleta datos detectados;

7. usuario revisa/corrige;

8. usuario marca confirmación;

9. usuario guarda;

10. ORBIT muestra confirmación visual.



Texto de autorización:



> Autorizo a ORBIT NEXUS a leer esta Constancia de Situación Fiscal con la finalidad de extraer y prellenar mis datos fiscales. Podré revisar y corregir la información antes de guardarla. Esta autorización no implica la emisión de CFDI ni autoriza el uso de mi e.firma.



La casilla inicia desmarcada.



Debe registrarse auditoría de:



- usuario;

- Organization;

- documento;

- fecha/hora;

- versión del consentimiento.



Confirmación posterior:



> Revisé y confirmo que mis datos fiscales son correctos.



Después de guardar debe mostrarse:



`✓ Información guardada correctamente`



La extracción nunca convierte automáticamente información detectada en información confirmada.



---



# 7. Régimen fiscal



El régimen fiscal NO será un campo de texto libre.



Debe seleccionarse desde un catálogo controlado por ORBIT y basado en los catálogos fiscales vigentes utilizados para CFDI.



Esta regla aplica como mínimo en:



- Perfil Fiscal;

- Clientes;

- Invoice Studio cuando sea necesario mostrar o validar el régimen.



La interfaz debe mostrar siempre:



`Código · Descripción`



Ejemplos:



`601 · General de Ley Personas Morales`



`603 · Personas Morales con Fines no Lucrativos`



`605 · Sueldos y Salarios e Ingresos Asimilados a Salarios`



`606 · Arrendamiento`



El usuario nunca debe tener que memorizar únicamente el código.



El selector debe permitir:



- búsqueda por código;

- búsqueda por nombre o descripción;

- selección mediante teclado;

- selección mediante mouse/touch;

- visualización clara de código y descripción;

- mantener seleccionado el régimen actualmente guardado;

- cambiarlo antes de confirmar los datos.



El valor persistido en base de datos seguirá siendo el código fiscal.



La descripción es información de presentación y catálogo.



Frontend NO debe:



- inventar códigos;

- permitir escribir cualquier valor arbitrario;

- considerar válido un régimen únicamente porque tenga tres dígitos;

- mantener una copia incompatible del catálogo fiscal.



Backend es la autoridad de validación.



Como mínimo debe validar:



- existencia del código;

- que el código esté activo cuando exista información de vigencia;

- compatibilidad con persona física o moral cuando aplique;

- compatibilidad con las reglas fiscales soportadas por ORBIT;

- compatibilidad con Uso CFDI cuando corresponda.



Si el régimen obtenido desde una Constancia de Situación Fiscal tiene más de una opción vigente para el contribuyente:



- ORBIT debe mostrar todas las opciones detectadas;

- no elegir silenciosamente una;

- el usuario debe seleccionar el régimen que utilizará;

- la elección debe quedar confirmada antes de guardarse.



Si ORBIT no puede verificar un régimen contra su fuente disponible:



- debe marcarlo como no verificado;

- debe solicitar revisión;

- no debe presentarlo como validado por SAT;

- debe bloquear `READY` cuando esa incertidumbre afecte la validez fiscal del CFDI.



La fuente del catálogo debe poder actualizarse sin cambiar el contrato del frontend.



No hardcodear permanentemente el catálogo dentro de componentes React.



---



# 8. Extracción de Constancia de Situación Fiscal



La Constancia de Situación Fiscal debe tratarse como un documento fiscal privado.



ORBIT debe separar claramente tres niveles de información:



1. documento original;

2. información detectada automáticamente;

3. información revisada y confirmada por el usuario.



Estos tres niveles NO son equivalentes.



Subir una Constancia no significa que sus datos hayan sido confirmados.



Detectar un dato no significa que sea correcto.



Guardar datos fiscales requiere revisión y confirmación explícita del usuario.



## 8.1 Flujo de extracción



El flujo será:



1. usuario carga la Constancia;

2. ORBIT almacena el documento de forma privada;

3. ORBIT muestra el consentimiento correspondiente;

4. mientras no exista consentimiento, el documento NO se procesa para autocompletado;

5. usuario acepta;

6. ORBIT procesa el documento;

7. ORBIT genera un resultado de extracción;

8. frontend muestra los campos detectados;

9. usuario revisa;

10. usuario corrige cualquier dato necesario;

11. usuario confirma;

12. únicamente entonces los datos pueden guardarse como datos fiscales confirmados.



## 8.2 Información que ORBIT puede extraer



Cuando el documento lo contenga de forma identificable, ORBIT puede intentar detectar:



- RFC;

- nombre;

- razón social;

- denominación;

- tipo de persona;

- código postal;

- domicilio fiscal;

- calle;

- número exterior;

- número interior;

- colonia;

- localidad;

- municipio o alcaldía;

- estado;

- país;

- régimen fiscal;

- múltiples regímenes fiscales cuando existan;

- fecha de inicio de operaciones cuando sea útil;

- otros datos fiscales expresamente definidos en el parser.



No incorporar automáticamente campos no contemplados por el contrato.



## 8.3 Información que ORBIT NO debe inventar



La Constancia no autoriza a ORBIT a inferir silenciosamente:



- Uso CFDI;

- forma de pago;

- método de pago;

- moneda;

- correo electrónico;

- teléfono;

- condiciones comerciales;

- datos bancarios;

- tipo de factura;

- valores fiscales ausentes;

- cualquier dato obtenido únicamente mediante suposición.



Cuando un campo no aparezca en el documento:



`null / pendiente de captura`



es preferible a inventar un valor.



## 8.4 Confianza y revisión



Cada campo extraído puede contener metadata equivalente a:



```ts

type ExtractedFiscalField = {

  value: string | null;

  confidence?: number;

  source?: string;

  status:

    | "DETECTED"

    | "LOW_CONFIDENCE"

    | "AMBIGUOUS"

    | "NOT_FOUND";

};



```



El contrato exacto puede ajustarse durante implementación sin cambiar esta semántica.



Cuando exista:



- baja confianza;

- más de un valor posible;

- texto ilegible;

- contradicción interna;

- dato incompleto;

- parser incapaz de determinar el campo;



ORBIT debe marcarlo para revisión.



Nunca convertir automáticamente:



`LOW_CONFIDENCE`



en:



`CONFIRMED`



## 8.5 Múltiples regímenes



Si la Constancia contiene más de un régimen fiscal:



- conservar todos los regímenes detectados;

- mostrarlos con código y descripción;

- permitir al usuario seleccionar el que corresponda;

- no utilizar automáticamente el primero de la lista;

- no descartar los demás durante la extracción.



El régimen finalmente guardado como principal debe provenir de una acción explícita del usuario.



## 8.6 Datos anteriores



Si ya existe un Perfil Fiscal confirmado y se carga una nueva Constancia:



ORBIT NO debe sobrescribir silenciosamente la información existente.



Debe mostrar diferencias entre:



- dato actual;

- dato detectado en la nueva Constancia.



Ejemplo conceptual:



`Razón social actual`



vs.



`Razón social detectada`



El usuario decide qué información actualizar.



Una nueva extracción nunca modifica automáticamente:



- facturas `ISSUED`;

- snapshots históricos;

- información fiscal confirmada previamente.



## 8.7 Persistencia



El documento original debe permanecer separado de la información extraída.



La información detectada puede persistirse como resultado de análisis.



La información confirmada se guarda únicamente tras revisión del usuario.



Conceptualmente:



```text

CSF PDF

   ↓

ExtractionResult

   ↓

User Review

   ↓

Confirmed Fiscal Data

```



No utilizar directamente `ExtractionResult` como fuente definitiva para timbrado.



## 8.8 Errores de lectura



Si ORBIT no puede leer correctamente la Constancia:



- no bloquear permanentemente el perfil;

- permitir captura manual;

- informar que el documento no pudo procesarse;

- conservar el documento si el usuario autorizó su almacenamiento;

- no generar datos ficticios;

- no marcar el perfil como validado automáticamente.



Mensaje de referencia:



`No pudimos identificar todos los datos de tu Constancia. Puedes revisarlos y completarlos manualmente.`



El usuario siempre conserva la posibilidad de completar sus datos de forma manual.



---



# 9. Consentimiento, autorización y privacidad



La lectura automática de documentos fiscales requiere una acción afirmativa del usuario.



La mera carga de un archivo NO autoriza automáticamente:



- extracción de información;

- autocompletado;

- timbrado;

- uso de CSD;

- uso de e.firma;

- finalidades distintas a las mostradas.



La autorización de lectura debe ser:



- previa al procesamiento;

- explícita;

- específica para la finalidad indicada;

- informada;

- registrable y auditable.



La casilla de autorización inicia siempre desmarcada.



## 9.1 Autorización para Constancia propia



Para la Constancia de Situación Fiscal del emisor se utilizará como base:



> Autorizo a ORBIT NEXUS a leer esta Constancia de Situación Fiscal con la finalidad de extraer y prellenar mis datos fiscales. Podré revisar y corregir la información antes de guardarla. Esta autorización no implica la emisión de CFDI ni autoriza el uso de mi e.firma.



Aceptar esta autorización permite únicamente:



- procesar el documento;

- extraer información fiscal;

- presentar información para revisión;

- prellenar el formulario correspondiente.



No permite:



- timbrar;

- firmar CFDI;

- utilizar un CSD;

- realizar operaciones fiscales en nombre del usuario fuera del flujo autorizado.



## 9.2 Registro de autorización



Cada autorización debe generar evidencia equivalente a:



```ts

export type FiscalDocumentConsent = {

  organizationId: string;

  userId: string;

  documentId: string;

  purpose:

    | "FISCAL_PROFILE_PREFILL"

    | "CLIENT_FISCAL_PREFILL";

  consentVersion: string;

  acceptedAt: string;

};

```



Puede ampliarse con metadata técnica necesaria para auditoría, sin almacenar información innecesaria.



La evidencia debe permitir responder:



- quién autorizó;

- qué documento se procesó;

- para qué finalidad;

- qué versión del texto aceptó;

- cuándo ocurrió.



No almacenar en esta evidencia:



- contraseña del CSD;

- llave privada;

- secretos PAC;

- contenido completo del documento si no es necesario.



## 9.3 Aviso de Privacidad



El checkbox de autorización NO sustituye el Aviso de Privacidad de ORBIT.



ORBIT debe disponer de un Aviso de Privacidad aplicable al tratamiento realizado.



El flujo debe permitir al usuario conocer, según corresponda:



- identidad del responsable;

- datos tratados;

- finalidad del tratamiento;

- mecanismos para limitar uso o divulgación;

- mecanismos para ejercer derechos aplicables;

- forma de consultar el Aviso de Privacidad completo;

- cambios relevantes al aviso.



La autorización específica de lectura debe estar vinculada al Aviso de Privacidad vigente.



## 9.4 Minimización



ORBIT procesará únicamente la información necesaria para la funcionalidad fiscal solicitada.



Los datos extraídos de documentos fiscales NO deben utilizarse para:



- publicidad basada en información fiscal;

- venta de información;

- creación de perfiles comerciales no necesarios;

- entrenamiento externo no autorizado;

- finalidades incompatibles con el servicio.



## 9.5 Revocación y registros históricos



La revocación de una autorización futura no debe destruir registros fiscales o de auditoría que legal o técnicamente deban conservarse.



Debe distinguirse entre:



- detener nuevos tratamientos opcionales;

- eliminar información que pueda eliminarse;

- conservar evidencia necesaria para seguridad, auditoría o cumplimiento.



No prometer eliminación inmediata de información cuando exista una obligación válida de conservación.



---



# 10. Clientes y Constancia de Situación Fiscal de terceros



ORBIT debe permitir crear y administrar clientes sin exigir obligatoriamente la Constancia de Situación Fiscal.



La Constancia del cliente será:



`Opcional pero recomendada para autocompletar y reducir errores de captura.`



Nunca debe mostrarse al usuario que una CSF es requisito legal obligatorio para expedir un CFDI.



## 10.1 Datos fiscales del receptor



El flujo debe permitir capturar y validar como mínimo los datos requeridos por el dominio soportado:



- RFC;

- nombre, denominación o razón social;

- código postal del domicilio fiscal;

- régimen fiscal;

- Uso CFDI.



Otros datos de contacto o administración podrán solicitarse cuando sean necesarios para funciones adicionales de ORBIT.



El correo electrónico NO debe presentarse como requisito fiscal obligatorio para expedir el CFDI.



## 10.2 Régimen fiscal del cliente



El régimen fiscal del cliente NO será texto libre.



Debe utilizar el mismo sistema de catálogo fiscal controlado definido en la sección 7.



La interfaz mostrará:



`Código · Descripción`



Ejemplo:



`601 · General de Ley Personas Morales`



El usuario podrá buscar por:



- código;

- descripción.



Backend valida el código y sus compatibilidades fiscales.



## 10.3 Carga opcional de Constancia del cliente



Si el usuario decide cargar la Constancia de un cliente:



1. selecciona o crea el cliente;

2. carga el PDF;

3. ORBIT conserva el archivo de forma privada;

4. ORBIT muestra la declaración correspondiente;

5. el documento NO se procesa todavía;

6. el usuario acepta;

7. ORBIT procesa el documento;

8. ORBIT muestra información detectada;

9. el usuario revisa;

10. corrige si es necesario;

11. confirma;

12. guarda los datos.



Texto base:



> Declaro que cuento con facultades o una base legítima para proporcionar y tratar esta información fiscal del cliente con la finalidad de administrar y preparar sus comprobantes fiscales en ORBIT NEXUS.



La casilla inicia desmarcada.



## 10.4 Datos de terceros



La aceptación anterior representa una declaración del usuario de ORBIT sobre la legitimidad de los datos que proporciona.



No debe interpretarse automáticamente como consentimiento otorgado directamente por la persona titular de todos los datos contenidos en el documento.



La arquitectura debe permitir que los términos, contratos y Aviso de Privacidad de ORBIT definan correctamente las responsabilidades entre:



- ORBIT;

- la Organization usuaria;

- el cliente/receptor;

- otros encargados o proveedores tecnológicos cuando corresponda.



No incorporar textos que afirmen una relación jurídica específica si dicha relación todavía no ha sido definida contractualmente.



## 10.5 Autocompletado



Cuando la extracción sea exitosa, ORBIT puede prellenar:



- RFC;

- nombre o razón social;

- código postal;

- domicilio;

- régimen o regímenes fiscales;

- demás datos expresamente soportados.



Los campos prellenados deben seguir siendo editables antes de su confirmación.



El usuario debe poder distinguir:



- información detectada;

- información modificada manualmente;

- información finalmente confirmada.



## 10.6 Uso CFDI



Uso CFDI NO debe autocompletarse suponiendo que la Constancia lo define.



Debe seleccionarse separadamente desde el catálogo correspondiente.



Backend debe validar su compatibilidad con:



- régimen fiscal;

- tipo de persona;

- reglas fiscales aplicables.



## 10.7 Cliente existente



Si se carga una nueva Constancia para un cliente que ya existe:



ORBIT debe comparar:



- datos actualmente guardados;

- datos detectados en el nuevo documento.



No sobrescribir automáticamente.



La interfaz debe permitir revisar diferencias antes de actualizar los datos maestros.



Las facturas históricas y sus snapshots no se modifican.



## 10.8 Fallo de extracción



Si ORBIT no puede procesar la Constancia del cliente:



- informar claramente el problema;

- permitir captura manual;

- no impedir la creación del cliente si los datos necesarios pueden capturarse manualmente;

- no inventar información;

- no presentar el cliente como verificado automáticamente.



## 10.9 Confirmación



Antes de guardar datos obtenidos mediante lectura automática, el usuario debe confirmar que revisó la información.



Texto de referencia:



> Revisé y confirmo que los datos fiscales del cliente son correctos.



Después de guardar correctamente:



`✓ Información guardada correctamente`



---



# 11. Datos maestros y snapshots fiscales



Perfil Fiscal y Cliente son datos maestros.



Las facturas NO deben depender permanentemente de que esos datos permanezcan sin cambios.



Al crear o guardar un borrador, ORBIT debe conservar snapshots de la información fiscal utilizada para esa factura.



Como mínimo, los snapshots deben permitir reconstruir qué datos tenía la factura al momento de su preparación.



## 11.1 Emisor



El snapshot del emisor puede incluir, según el alcance soportado:



- RFC;

- nombre o razón social;

- régimen fiscal;

- código postal;

- demás datos fiscales utilizados en el CFDI.



## 11.2 Receptor



El snapshot del receptor puede incluir:



- RFC;

- nombre o razón social;

- régimen fiscal;

- código postal;

- Uso CFDI;

- información fiscal adicional necesaria para el comprobante.



## 11.3 Cambios posteriores



Cambiar posteriormente:



- Perfil Fiscal;

- Cliente;

- Constancia;

- domicilio;

- régimen;

- datos administrativos;



NO debe modificar silenciosamente facturas históricas.



Reglas:



- `DRAFT` puede actualizar sus snapshots mediante una acción explícita;

- si cambian datos fiscales relevantes de un `READY`, debe regresar a `DRAFT`;

- después debe volver a validarse;

- `ISSUED` nunca se reescribe para reflejar cambios posteriores;

- los XML timbrados nunca se regeneran sustituyendo datos históricos.



La interfaz debe distinguir claramente entre:



`Datos actuales`



y:



`Datos guardados en esta factura`



## 11.4 Constancia nueva



Si se carga una nueva Constancia de Situación Fiscal:



ORBIT puede sugerir actualizar los datos maestros.



No debe modificar automáticamente:



- snapshots existentes;

- facturas READY;

- facturas ISSUED.



Si una factura READY depende de información que cambió, deberá indicarse que necesita revisión y revalidación.



---



# 12. Carga y validación del Certificado de Sello Digital



El flujo de Certificado de Sello Digital debe estar claramente separado del flujo de Constancia de Situación Fiscal.



La interfaz debe explicar que:



`La Constancia de Situación Fiscal identifica información fiscal.`



`El Certificado de Sello Digital se utiliza para sellar CFDI.`



No deben tratarse como el mismo documento ni como el mismo consentimiento.



## 12.1 Archivos requeridos



Para configurar un CSD, el usuario proporciona:



- certificado `.cer`;

- llave privada `.key`;

- contraseña de la llave privada.



No solicitar archivos de e.firma para este flujo.



## 12.2 Validación previa



Antes de guardar un CSD como configuración válida, backend debe verificar como mínimo:



- que el `.cer` pueda interpretarse;

- que la `.key` pueda interpretarse;

- que la contraseña permita abrir la llave;

- que certificado y llave privada correspondan;

- que el certificado tenga vigencia temporal válida;

- que el certificado corresponda al RFC esperado cuando esa información pueda verificarse;

- que el RFC sea compatible con la Organization activa;

- que el material criptográfico sea apto para el flujo soportado;

- que el archivo no exceda límites permitidos;

- que el tipo y contenido sean consistentes.



Un archivo con extensión correcta pero contenido inválido debe rechazarse.



## 12.3 Errores



Si la validación falla:



- NO habilitar timbrado;

- NO guardar la configuración como válida;

- NO intentar enviar al PAC;

- NO exponer la llave en la respuesta;

- NO devolver detalles criptográficos sensibles;

- mostrar un mensaje útil para el usuario.



Ejemplos conceptuales:



`No pudimos abrir la llave privada con la contraseña proporcionada.`



`El certificado y la llave privada no corresponden entre sí.`



`El Certificado de Sello Digital está vencido.`



`El RFC del certificado no corresponde al emisor configurado.`



## 12.4 Estado del CSD



La configuración debe poder representar estados equivalentes a:



- `NOT_CONFIGURED`

- `VALIDATING`

- `VALID`

- `INVALID`

- `EXPIRED`



La UI puede usar textos más amigables, pero backend conserva la autoridad.



Solo:



`VALID`



puede habilitar un intento real de timbrado.



## 12.5 Renovación



Un nuevo CSD no sobrescribe silenciosamente evidencia necesaria del anterior.



La arquitectura debe permitir:



- reemplazar un CSD;

- conservar metadata mínima necesaria para auditoría;

- desactivar el anterior;

- impedir uso de certificados vencidos o desactivados.



No es necesario conservar indefinidamente la llave privada antigua si ya no existe una razón operativa o legal para hacerlo.



## 12.6 Contraseña



La contraseña de la llave privada:



- se recibe únicamente cuando sea necesaria;

- nunca se persiste en texto plano;

- nunca se envía al PAC salvo que el contrato técnico realmente lo requiera y haya sido autorizado arquitectónicamente;

- nunca se devuelve al frontend;

- nunca se incluye en logs;

- nunca se incluye en errores;

- nunca se incluye en ActivityLog;

- se descarta de memoria tan pronto como sea razonablemente posible.



En esta primera implementación, ORBIT NO promete timbrado desatendido permanente si eso requiere conservar la contraseña.



---



# 13. Seguridad y custodia del CSD



La llave privada del Certificado de Sello Digital debe tratarse como material criptográfico altamente sensible.



## 13.1 Cifrado



La llave privada debe almacenarse cifrada en reposo.



No es suficiente:



- base64;

- ocultar el nombre del archivo;

- cambiar la extensión;

- confiar únicamente en permisos de aplicación.



El cifrado debe utilizar una clave de cifrado separada del contenido almacenado.



La clave maestra o material equivalente NO se guarda junto a la llave cifrada en la misma fila de Prisma.



## 13.2 Aislamiento tenant



Todo acceso al CSD debe resolverse desde:



- sesión válida;

- Membership válida;

- Organization autorizada.



Nunca aceptar un `organizationId` libre enviado por el navegador como autoridad.



Una Organization nunca puede:



- leer;

- reemplazar;

- validar;

- firmar;



con el CSD de otra Organization.



## 13.3 Exposición



El backend nunca debe devolver:



- contenido de `.key`;

- contraseña;

- material descifrado;

- secretos PAC;

- claves de cifrado.



La UI únicamente recibe metadata segura, por ejemplo:



- certificado configurado;

- fecha de vigencia;

- RFC;

- estado;

- fecha de actualización.



## 13.4 Logs



Nunca registrar:



- archivo `.key`;

- contenido `.cer` completo si no es necesario;

- contraseña;

- XML previo a sanitización cuando contenga información sensible innecesaria;

- secretos PAC;

- headers de autenticación;

- claves de cifrado.



Los errores deben sanitizar información sensible antes de persistirse o enviarse a observabilidad.



## 13.5 Archivos públicos



CSD y material criptográfico nunca deben:



- guardarse bajo `/public`;

- exponerse mediante URL pública;

- enviarse a CDN pública;

- almacenarse como asset descargable sin autorización;

- quedar incluidos en builds;

- quedar incluidos en backups públicos;

- llegar a Git.



## 13.6 Auditoría



ActivityLog puede registrar eventos como:



- `CSD_CONFIGURED`

- `CSD_REPLACED`

- `CSD_VALIDATION_FAILED`

- `CSD_EXPIRED`

- `STAMP_REQUESTED`



La auditoría puede guardar:



- Organization;

- usuario;

- fecha/hora;

- resultado;

- identificadores no sensibles.



Nunca debe guardar material criptográfico.



## 13.7 Fail closed



Ante cualquier incertidumbre sobre:



- descifrado;

- contraseña;

- correspondencia certificado/llave;

- RFC;

- vigencia;

- autorización;

- integridad;



el comportamiento es:



`NO TIMBRAR`



Nunca continuar parcialmente esperando que el PAC detecte el problema.



## 13.8 Tests



Los tests automatizados deben utilizar exclusivamente:



- certificados sintéticos;

- llaves generadas para pruebas;

- credenciales PAC de sandbox;

- datos fiscales ficticios o expresamente preparados para pruebas.



Nunca incorporar certificados reales de producción al repositorio.



---



# 14. Fuente técnica oficial del CFDI



La implementación fiscal NO debe depender de reglas inventadas por ORBIT ni de ejemplos aislados de terceros.



Para CFDI 4.0, la fuente técnica de referencia será la documentación oficial vigente publicada por el SAT.



Como mínimo:



- Anexo 20 aplicable;

- esquema XSD de CFDI 4.0;

- catálogo de datos CFDI;

- XSLT oficial para cadena original;

- matrices de errores aplicables;

- catálogos fiscales vigentes;

- esquemas y documentación de complementos únicamente cuando sean soportados.



La versión inicial de timbrado de Fase 5C soporta:



`CFDI 4.0`



y, dentro del alcance actual:



`Tipo I · Ingreso`



Los tipos:



- Egreso;

- Traslado;

- Nómina;

- Complemento de Pago;

- Carta Porte;

- Comercio Exterior;

- otros complementos;



NO deben declararse soportados hasta implementar y validar sus reglas específicas.



## 14.1 Recursos técnicos



Los recursos técnicos oficiales utilizados por ORBIT deben:



- tener versión identificable;

- poder auditarse;

- actualizarse mediante un procedimiento controlado;

- no modificarse silenciosamente durante una operación de timbrado;

- no depender de descargar archivos remotos del SAT en cada factura.



ORBIT puede mantener copias técnicas versionadas de:



- XSD;

- XSLT;

- catálogos;

- metadata de versión;



siempre que provengan de la fuente oficial y exista trazabilidad de origen y versión.



Una actualización de recursos fiscales debe pasar por:



- revisión;

- tests;

- validación;

- despliegue controlado.



No sustituir automáticamente un XSD o XSLT en producción únicamente porque una URL remota haya cambiado.



---



# 15. Construcción del XML CFDI 4.0



ORBIT construirá el CFDI de forma determinística desde información validada por backend.



El navegador NO es autoridad para:



- totales;

- impuestos;

- subtotales;

- descuentos;

- RFC;

- snapshots;

- fecha fiscal;

- número de certificado;

- sello;

- estado;

- UUID.



El XML debe construirse únicamente desde información server-side autorizada.



## 15.1 Requisitos estructurales



El CFDI debe:



- utilizar codificación UTF-8;

- utilizar el namespace oficial correspondiente;

- referenciar el esquema CFDI 4.0 aplicable;

- respetar estructura, orden, tipos y restricciones del XSD;

- respetar catálogos fiscales;

- expresar importes con la precisión requerida;

- utilizar los snapshots fiscales almacenados en el draft;

- reflejar exactamente los conceptos y cálculos validados por ORBIT.



El XML previo al timbrado NO contiene:



- UUID inventado;

- Timbre Fiscal Digital ficticio;

- sello SAT ficticio;

- fecha de timbrado ficticia.



## 15.2 Datos utilizados



La construcción debe utilizar como mínimo, según corresponda:



- emisor;

- receptor;

- lugar de expedición;

- fecha;

- tipo de comprobante;

- moneda;

- tipo de cambio cuando aplique;

- forma de pago cuando aplique;

- método de pago cuando aplique;

- Uso CFDI;

- exportación;

- conceptos;

- cantidades;

- claves producto/servicio;

- claves de unidad;

- ObjetoImp;

- descuentos;

- impuestos trasladados;

- retenciones;

- subtotal;

- total.



No utilizar información directamente del documento extraído sin confirmación previa.



## 15.3 Validación antes de firma



Antes de generar el sello:



1. construir XML;

2. validar estructura;

3. validar reglas fiscales internas;

4. validar contra XSD y recursos técnicos soportados;

5. confirmar que el draft continúa en estado `READY`;

6. confirmar que no cambió después de la validación.



Si falla cualquiera:



`NO FIRMAR`



y:



`NO ENVIAR AL PAC`



## 15.4 Determinismo



El mismo draft fiscal, bajo la misma versión de reglas y recursos técnicos, debe producir una representación fiscal consistente.



No depender de:



- orden aleatorio de objetos;

- locale del servidor;

- floating point de JavaScript;

- timezone del navegador;

- serialización JSON como autoridad fiscal.



Los importes continúan utilizando Decimal.



---



# 16. Cadena original y sello del emisor



ORBIT debe generar la cadena original utilizando el procedimiento técnico oficial aplicable al CFDI 4.0.



No construir manualmente la cadena concatenando campos según una implementación propia.



Debe utilizarse la transformación oficial correspondiente publicada por el SAT.



## 16.1 Cadena original



La cadena original:



- se deriva del XML fiscal;

- debe respetar la secuencia oficial;

- debe expresarse en UTF-8;

- debe generarse antes de la incorporación del Timbre Fiscal Digital;

- debe incluir los complementos soportados cuando éstos formen parte del comprobante.



El Timbre Fiscal Digital del PAC NO forma parte de la cadena original del CFDI previo al timbrado.



## 16.2 Digestión y firma



Para el estándar soportado, ORBIT debe aplicar el algoritmo requerido por el Anexo 20 vigente.



La implementación actual utilizará:



- digestión SHA-256;

- firma RSA con la llave privada del CSD correspondiente.



No implementar algoritmos criptográficos manualmente.



Utilizar primitivas criptográficas mantenidas y revisadas.



## 16.3 Datos del certificado



El XML debe incorporar correctamente, según el estándar:



- certificado;

- número de certificado;

- sello del CFDI.



Estos valores se derivan del CSD validado.



No aceptar estos campos desde el navegador.



## 16.4 Verificación local



Antes de enviar al PAC, ORBIT debe verificar localmente que:



- la cadena original corresponde al XML;

- el sello generado puede verificarse con el certificado;

- certificado y llave siguen siendo consistentes;

- el XML no cambió después de firmarse.



Si la verificación falla:



`NO ENVIAR AL PAC`



---



# 17. Contrato PacProvider



La integración con un PAC debe estar aislada detrás de una interfaz.



Contrato conceptual:



```ts

export type PacEnvironment = "SANDBOX" | "PRODUCTION";



export type PacStampInput = {

  organizationId: string;

  invoiceId: string;

  attemptId: string;

  idempotencyKey: string;

  signedXml: string;

  environment: PacEnvironment;

};



export type PacStampResult =

  | {

      status: "STAMPED";

      stampedXml: string;

      providerReference?: string;

    }

  | {

      status: "REJECTED";

      code: string;

      message: string;

    }

  | {

      status: "UNKNOWN";

      providerReference?: string;

      message: string;

    };



export interface PacProvider {

  stamp(input: PacStampInput): Promise<PacStampResult>;



  reconcile?(input: {

    organizationId: string;

    invoiceId: string;

    attemptId: string;

    idempotencyKey: string;

    providerReference?: string;

  }): Promise<PacStampResult>;

}

```



El contrato exacto puede ampliarse durante la implementación sin cambiar estas garantías.



## 17.1 Responsabilidades del adaptador



El adaptador PAC es responsable de:



- autenticación contra el proveedor;

- formato específico de request;

- timeout;

- interpretación de respuesta;

- normalización de errores;

- obtención del XML timbrado;

- reconciliación cuando el proveedor lo permita.



El dominio fiscal NO debe conocer:



- URL específicas de SW;

- nombres específicos de headers;

- formato particular de errores del proveedor;

- credenciales particulares del PAC.



## 17.2 Sandbox y producción



Sandbox y producción son entornos distintos.



Nunca usar credenciales sandbox como credenciales productivas.



Nunca mostrar una factura sandbox como CFDI productivo.



En producción:



`PacEnvironment` debe ser `PRODUCTION`.



Los tests y desarrollo deben utilizar:



`SANDBOX`



o adaptadores explícitamente falsos únicamente para tests automatizados.



Un mock jamás convierte una factura real en `ISSUED`.



---



# 18. Intentos de timbrado e idempotencia



Todo intento de timbrado debe tener identidad propia.



ORBIT debe impedir que:



- doble clic;

- reintento HTTP;

- refresh;

- timeout;

- pestañas simultáneas;

- worker duplicado;



generen dos timbrados de la misma factura.



## 18.1 StampAttempt



La arquitectura debe representar un intento equivalente a:



```ts

type StampAttemptStatus =

  | "PENDING"

  | "SIGNING"

  | "SUBMITTING"

  | "WAITING_PROVIDER"

  | "SUCCEEDED"

  | "FAILED"

  | "UNKNOWN";

```



Cada intento debe estar ligado como mínimo a:



- Organization;

- invoice;

- usuario o actor;

- idempotencyKey;

- versión del draft;

- ambiente PAC;

- proveedor;

- timestamps;

- estado.



## 18.2 Clave de idempotencia



La idempotencyKey debe ser:



- generada server-side;

- única;

- estable para el intento correspondiente;

- nunca controlada libremente por el navegador para cruzar tenants.



Si el mismo request seguro se repite:



ORBIT debe devolver el resultado existente cuando sea posible.



No crear un segundo intento únicamente porque se repitió la solicitud HTTP.



## 18.3 Un intento activo



Una factura no debe tener múltiples intentos de timbrado activos simultáneamente.



Si existe un intento:



- `SIGNING`;

- `SUBMITTING`;

- `WAITING_PROVIDER`;

- `UNKNOWN`;



no crear otro automáticamente.



## 18.4 Versión del draft



El intento debe estar asociado a la versión exacta del draft que se firmó.



Si el draft cambia después:



- el intento anterior no puede utilizarse para la nueva versión;

- la factura debe volver a validarse;

- cualquier nuevo intento utiliza una nueva versión.



---



# 19. Validación de respuesta del PAC



Una respuesta HTTP exitosa del PAC NO significa automáticamente que exista un CFDI válido.



ORBIT debe validar el resultado antes de cambiar a `ISSUED`.



## 19.1 XML timbrado



Para considerar un resultado válido, ORBIT debe recibir y analizar el XML timbrado.



Debe verificar como mínimo:



- XML parseable;

- estructura CFDI esperada;

- Timbre Fiscal Digital presente;

- UUID presente y con formato válido;

- fecha de timbrado presente;

- RFC del proveedor de certificación cuando aplique;

- sello CFDI presente;

- sello SAT presente;

- número de certificado SAT presente;

- RFC emisor coincidente;

- RFC receptor coincidente;

- total coincidente;

- moneda coincidente;

- datos críticos consistentes con el XML enviado.



La validación puede ampliarse conforme a las reglas técnicas del estándar y del PAC.



## 19.2 No confiar en campos paralelos



Si el PAC devuelve:



```json

{

  "success": true,

  "uuid": "..."

}

```



pero no existe XML timbrado válido:



`NO ISSUED`



El XML timbrado es la evidencia principal.



## 19.3 UUID



El UUID:



- nunca se genera en ORBIT;

- nunca se acepta desde el navegador;

- nunca se inventa como fallback;

- se obtiene del Timbre Fiscal Digital real.



## 19.4 Hashes



ORBIT debe considerar guardar hashes criptográficos del:



- XML firmado enviado;

- XML timbrado recibido.



Esto permite:



- integridad;

- auditoría;

- detección de alteraciones;

- investigación de incidentes.



---



# 20. Errores, timeouts y respuestas ambiguas



Los errores de timbrado deben clasificarse.



No todos los errores permiten reintentar.



## 20.1 Error antes del envío



Si el fallo ocurre antes de que el request llegue al PAC, por ejemplo:



- XML inválido;

- CSD inválido;

- fallo de firma;

- validación fiscal;

- credenciales PAC ausentes;



el intento puede marcarse:



`FAILED`



y puede permitirse un nuevo intento después de corregir la causa.



## 20.2 Rechazo explícito del PAC



Si el PAC confirma que NO timbró el CFDI:



`FAILED`



o estado equivalente.



La UI debe mostrar un mensaje entendible y conservar el código técnico para soporte.



No convertir el error técnico completo en información pública al usuario.



## 20.3 Resultado ambiguo



Si ocurre:



- timeout después de enviar;

- conexión cortada después de submit;

- respuesta corrupta;

- respuesta desconocida;

- estado del proveedor incierto;



el intento debe pasar a:



`UNKNOWN`



No reintentar automáticamente.



Debe ejecutarse reconciliación con el PAC cuando exista mecanismo disponible.



## 20.4 Reconciliación



Antes de un nuevo submit tras un estado `UNKNOWN`, ORBIT debe intentar determinar si el proveedor ya timbró.



Puede utilizar:



- providerReference;

- idempotencyKey;

- UUID conocido;

- consulta específica del PAC;

- mecanismos soportados por el proveedor.



Si se recupera un XML timbrado válido:



finalizar el intento existente.



No crear otro CFDI.



## 20.5 Reintentos



Un reintento automático únicamente es válido cuando ORBIT puede demostrar que la operación anterior:



`NO fue procesada`



o cuando el PAC garantiza idempotencia suficiente para el mismo request.



Ante duda:



`NO RETRY AUTOMÁTICO`



---



# 21. Transición READY → ISSUED



La transición a `ISSUED` es una operación fiscal crítica.



Debe ocurrir únicamente después de validar completamente la respuesta del PAC.



## 21.1 Precondiciones



Antes de iniciar:



- sesión válida;

- Organization autorizada;

- plan habilitado;

- factura en `READY`;

- validación fiscal vigente;

- snapshot vigente;

- CSD `VALID`;

- proveedor PAC configurado;

- environment correcto;

- sin intento activo incompatible.



## 21.2 Flujo



El flujo será:



```text

READY

  ↓

crear StampAttempt

  ↓

revalidar factura

  ↓

construir XML CFDI 4.0

  ↓

validar XML

  ↓

generar cadena original

  ↓

firmar con CSD

  ↓

verificar firma local

  ↓

SUBMITTING

  ↓

PAC

  ↓

validar XML timbrado

  ↓

SUCCEEDED

  ↓

ISSUED

```



## 21.3 Persistencia final



La transición final debe persistir de forma transaccional, en la medida técnicamente posible:



- estado `ISSUED`;

- UUID;

- fecha de timbrado;

- XML timbrado;

- relación con StampAttempt;

- proveedor utilizado;

- metadata segura del PAC;

- timestamps;

- ActivityLog.



El XML se almacena como documento privado.



No guardar el XML fiscal bajo `/public`.



## 21.4 Representación PDF



El PDF NO sustituye el XML.



El PDF es una representación del CFDI.



Debe generarse únicamente a partir de información consistente con el XML timbrado.



Puede contener:



- datos del emisor;

- datos del receptor;

- conceptos;

- impuestos;

- totales;

- UUID;

- certificados;

- fecha de emisión;

- fecha de certificación;

- QR cuando corresponda;

- leyendas requeridas;

- cadena o información requerida por las disposiciones aplicables.



Un fallo al generar PDF después de recibir un XML timbrado válido NO debe provocar un segundo timbrado.



En ese escenario:



- CFDI sigue siendo `ISSUED`;

- XML permanece disponible;

- PDF puede regenerarse.



## 21.5 Inmutabilidad fiscal



Después de `ISSUED`:



- no editar receptor;

- no editar emisor;

- no editar conceptos;

- no editar impuestos;

- no editar totales;

- no regenerar UUID;

- no sustituir XML silenciosamente.



Cualquier corrección fiscal posterior deberá utilizar el mecanismo fiscal correspondiente en una fase posterior:



- cancelación;

- sustitución;

- CFDI relacionado;

- nota de crédito;



según el caso soportado.



## 21.6 Sandbox



Un CFDI generado mediante sandbox:



- no se considera factura productiva;

- no debe aparecer mezclado con emisiones reales;

- debe estar claramente identificado;

- no debe alterar métricas productivas;

- no debe enviarse al cliente como comprobante fiscal válido.



---



# 22. PAC inicial: SW sapien / SmarterWEB



El PAC inicial seleccionado para Fase 5C es:



`SW sapien / SmarterWEB`



La selección del proveedor NO convierte sus convenciones técnicas en reglas internas de ORBIT.



Antes de habilitar producción debe verificarse nuevamente que:



- el proveedor continúe con autorización vigente aplicable;

- el contrato comercial corresponda al servicio que ORBIT necesita;

- exista un esquema válido para múltiples emisores cuando corresponda;

- exista ambiente sandbox o pruebas;

- estén disponibles los servicios necesarios para CFDI 4.0;

- las credenciales productivas estén correctamente segregadas;

- se conozcan límites, cuotas, SLA y mecanismos de soporte;

- se conozcan mecanismos disponibles de consulta o reconciliación.



No implementar endpoints, headers, parámetros o formatos de SW basándose en memoria, ejemplos no oficiales o suposiciones.



El adaptador debe construirse únicamente después de revisar:



- documentación técnica vigente del proveedor;

- contrato correspondiente;

- credenciales del ambiente correcto;

- ejemplos oficiales;

- reglas de timbrado aplicables.



## 22.1 Verificación de autorización



Antes de activar un proveedor en producción debe existir un procedimiento operativo para verificar su situación vigente.



ORBIT no debe presentar de forma permanente un texto equivalente a:



`Proveedor autorizado vigente`



basándose únicamente en información hardcodeada antigua.



La verificación puede ser operativa/manual inicialmente, pero debe quedar documentada.



## 22.2 Identidad visible



Cuando una factura sea timbrada, ORBIT debe poder conservar metadata suficiente para saber:



- qué PAC se utilizó;

- qué ambiente se utilizó;

- qué intento produjo el resultado;

- qué referencia devolvió el proveedor cuando exista.



No almacenar credenciales dentro de esa metadata.



## 22.3 Segundo proveedor



La arquitectura debe permitir añadir en el futuro otro PAC sin:



- cambiar Invoice Studio;

- cambiar el modelo conceptual de CFDI;

- cambiar estados fiscales;

- duplicar lógica de negocio.



El proveedor alternativo implementará el mismo contrato `PacProvider`.



---



# 23. Configuración y secretos del PAC



La configuración del PAC debe separarse entre:



1. configuración no sensible;

2. secretos.



## 23.1 Configuración no sensible



Puede incluir metadata como:



- proveedor seleccionado;

- ambiente;

- versión del adaptador;

- features disponibles;

- fecha de configuración;

- estado de configuración.



Esta información puede persistirse cuando sea necesario.



## 23.2 Secretos



Credenciales como:



- API key;

- token;

- username/password;

- client secret;

- certificados específicos del proveedor;

- cualquier secreto de autenticación;



NO deben guardarse como texto plano en Prisma.



Los secretos productivos deben administrarse mediante mecanismos seguros de configuración del entorno o secret management.



En el despliegue actual, como mínimo:



- variables secretas de Vercel para producción;

- variables distintas para Preview/Development cuando corresponda;

- nunca `.env.example` con valores reales;

- nunca Git;

- nunca logs;

- nunca respuesta HTTP al navegador.



## 23.3 Separación sandbox / producción



Las credenciales de sandbox y producción deben ser diferentes.



El código debe impedir utilizar accidentalmente:



- credenciales sandbox contra producción;

- credenciales productivas en tests;

- entorno productivo desde E2E local.



La configuración debe requerir correspondencia explícita entre:



`PacEnvironment`



y:



`credenciales`



## 23.4 Rotación



La arquitectura debe permitir:



- reemplazar credenciales;

- revocar credenciales anteriores;

- rotar secretos sin modificar código;

- detectar configuración ausente.



Una credencial inválida produce:



`FAILED`



antes de declarar cualquier factura como `ISSUED`.



---



# 24. Almacenamiento de XML y PDF



Los documentos fiscales emitidos son privados.



El XML timbrado es la evidencia fiscal principal que conserva ORBIT dentro de este flujo.



## 24.1 XML previo al timbrado



Puede conservarse cuando sea necesario para:



- auditoría;

- reconciliación;

- diagnóstico;

- integridad del intento.



Si se conserva:



- debe almacenarse de forma privada;

- asociado a Organization;

- asociado al StampAttempt;

- con hash;

- sin URL pública.



## 24.2 XML timbrado



Cuando el PAC devuelve un CFDI válido, ORBIT debe almacenar:



- XML original timbrado recibido;

- hash criptográfico;

- UUID;

- metadata necesaria;

- Organization;

- invoice;

- StampAttempt.



El contenido recibido del PAC no debe ser reconstruido posteriormente como sustituto del original.



## 24.3 PDF



El PDF se genera desde los datos del XML timbrado.



Puede regenerarse cuando sea necesario.



No debe considerarse autoridad superior al XML.



Si:



`XML válido + PDF falla`



la factura permanece:



`ISSUED`



y el sistema puede volver a generar el PDF.



## 24.4 Descarga



Los endpoints de descarga deben:



- requerir sesión;

- resolver Organization server-side;

- comprobar acceso;

- utilizar identificadores internos;

- usar `Cache-Control` apropiado;

- evitar paths proporcionados libremente por el cliente.



Nunca devolver archivos fiscales de otra Organization.



## 24.5 Integridad



Los hashes deben calcularse sobre los bytes o representación canónica definida por la implementación.



Si posteriormente el contenido almacenado no coincide con su hash:



- marcar incidente;

- no sustituir silenciosamente;

- no continuar como si el documento fuese íntegro.



---



# 25. Auditoría fiscal



Las operaciones relacionadas con timbrado deben ser auditables.



ActivityLog debe registrar eventos relevantes sin almacenar secretos.



Eventos conceptuales:



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



La nomenclatura exacta puede adaptarse manteniendo estas semánticas.



## 25.1 Información permitida



Puede registrarse:



- Organization;

- userId;

- invoiceId;

- attemptId;

- acción;

- estado;

- proveedor;

- ambiente;

- timestamps;

- código normalizado de error;

- providerReference no sensible;

- UUID después de timbrado.



## 25.2 Información prohibida



No registrar:



- contraseña del CSD;

- llave privada;

- material descifrado;

- API tokens;

- Authorization headers;

- secretos PAC;

- contenido de certificados privados;

- XML completo salvo que exista un mecanismo específico y seguro distinto de ActivityLog.



## 25.3 Inmutabilidad



Los registros de auditoría no deben utilizarse como mecanismo para modificar la factura.



La auditoría describe eventos.



No es la fuente autoritativa del estado fiscal.



---



# 26. Concurrencia y consistencia



El flujo de timbrado debe asumir que pueden existir solicitudes simultáneas.



No confiar únicamente en deshabilitar un botón en frontend.



## 26.1 Bloqueo lógico



Antes de crear un StampAttempt, backend debe comprobar transaccionalmente:



- invoice pertenece al tenant;

- estado es `READY`;

- no existe intento activo incompatible;

- versión del draft continúa vigente.



La base de datos debe ayudar a garantizar que dos solicitudes simultáneas no creen dos intentos activos válidos.



Puede utilizarse:



- restricción única;

- activeKey;

- escritura condicional;

- transaction;

- optimistic concurrency;



según la solución elegida.



## 26.2 Cambios durante el proceso



Después de comenzar un intento:



la versión fiscal utilizada queda congelada para ese intento.



Si un usuario intenta editar mientras existe un intento activo:



- bloquear edición fiscal;

- o exigir resolución explícita del intento;



según el estado.



Nunca modificar el XML ya firmado para reflejar una edición posterior.



## 26.3 Respuestas tardías



Una respuesta tardía de un intento anterior no debe sobrescribir una factura que ya fue resuelta correctamente por otro proceso autorizado.



Toda respuesta debe correlacionarse con:



- attemptId;

- invoiceId;

- Organization;

- versión;

- providerReference cuando exista.



## 26.4 Reintentos del navegador



El frontend puede repetir una solicitud por problemas de red.



Backend debe tratar esa repetición de forma idempotente.



No confiar en que el navegador enviará una sola vez.



---



# 27. Seguridad de red y comunicación con el PAC



Todas las comunicaciones productivas con el PAC deben utilizar transporte seguro.



## 27.1 HTTPS



Producción requiere:



`HTTPS`



No enviar CFDI, credenciales ni información fiscal mediante HTTP sin cifrado.



La validación TLS no debe desactivarse para "hacer funcionar" una integración.



No aceptar certificados TLS inválidos silenciosamente.



## 27.2 Destinos permitidos



El adaptador PAC debe comunicarse únicamente con hosts explícitamente configurados/autorizados.



No permitir que:



- un parámetro del usuario;

- un campo del draft;

- una URL almacenada por un cliente;



determine libremente el destino del request PAC.



Esto reduce riesgos SSRF.



## 27.3 Redirects



Los redirects del proveedor deben tratarse de forma restrictiva.



No seguir automáticamente redirects hacia hosts:



- desconocidos;

- privados;

- locales;

- no autorizados.



Preferiblemente el adaptador utiliza endpoints finales documentados sin redirects dinámicos.



## 27.4 Timeouts



Toda solicitud PAC debe tener timeout explícito.



Un timeout después de enviar la solicitud se trata como:



`UNKNOWN`



cuando no pueda demostrarse que el PAC no procesó la operación.



No clasificar automáticamente un timeout como:



`FAILED seguro para retry`



## 27.5 Tamaños



Definir límites razonables para:



- XML enviado;

- XML recibido;

- respuesta JSON;

- mensajes de error.



No aceptar respuestas ilimitadas en memoria.



## 27.6 Sanitización de errores



Los errores del proveedor deben normalizarse antes de:



- mostrarlos al usuario;

- guardarlos en auditoría;

- enviarlos a observabilidad.



Eliminar o redactar:



- tokens;

- credenciales;

- Authorization;

- cookies;

- material criptográfico;

- información técnica innecesariamente sensible.



## 27.7 Rate limiting



Las rutas de timbrado requieren rate limiting independiente de las operaciones normales.



El rate limit no sustituye:



- idempotencia;

- autorización;

- control de concurrencia.



## 27.8 Producción y desarrollo



El código debe fallar de forma segura si en producción faltan:



- credenciales PAC;

- configuración de ambiente;

- clave de cifrado;

- CSD válido;

- recursos fiscales requeridos.



Nunca sustituir automáticamente una dependencia productiva ausente por:



- mock;

- fixture;

- sandbox;

- respuesta simulada.



En producción:



`configuración incompleta = timbrado deshabilitado`



---



# 28. Autorización final para timbrar



Configurar un CSD NO significa que ORBIT pueda timbrar automáticamente cualquier factura.



En Fase 5C, cada emisión productiva requiere una acción explícita del usuario sobre una factura específica.



Antes del submit al PAC, la interfaz debe mostrar una revisión final de:



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



El usuario debe realizar una acción afirmativa equivalente a:



> Revisé la información del CFDI y autorizo a ORBIT NEXUS a utilizar el Certificado de Sello Digital configurado para sellar este comprobante y enviarlo al PAC para su certificación.



La casilla:



- inicia desmarcada;

- aplica únicamente al CFDI mostrado;

- no constituye autorización ilimitada para futuras facturas;

- no autoriza uso de e.firma;

- no permite modificar datos después del sellado.



Debe registrarse:



- userId;

- organizationId;

- invoiceId;

- versión del draft;

- texto/versión de autorización;

- acceptedAt.



Después de aceptar, el botón de acción puede mostrarse como:



`Timbrar CFDI`



No utilizar textos ambiguos como:



- Guardar;

- Continuar;

- Finalizar;



para una operación fiscal real.



---



# 29. UX del timbrado



La UI nunca debe presentar éxito antes de recibir y validar el XML timbrado real.



Estados visibles conceptuales:



## READY



`La factura está validada y lista para timbrarse.`



## SIGNING



`Preparando y sellando el CFDI.`



## SUBMITTING / WAITING_PROVIDER



`Enviando el CFDI al proveedor de certificación.`



La interfaz debe evitar que el usuario dispare otra solicitud mientras exista un intento activo.



## ISSUED



Únicamente después de validación real:



`✓ CFDI timbrado correctamente`



Puede mostrar:



- UUID;

- fecha de timbrado;

- PAC;

- total;

- botón XML;

- botón PDF.



## FAILED



Debe mostrar una explicación clara y accionable.



Ejemplo:



`No fue posible timbrar el CFDI. Revisa la información indicada antes de intentarlo nuevamente.`



Cuando exista un código técnico:



- conservarlo para soporte;

- no mostrar secretos;

- mostrarlo únicamente cuando ayude al usuario.



## UNKNOWN



Cuando ORBIT no puede determinar si el PAC procesó la solicitud:



`Estamos verificando el estado de este CFDI. No vuelvas a timbrarlo mientras realizamos la comprobación.`



En este estado:



- bloquear otro submit;

- ofrecer actualización/reconciliación;

- no marcar ISSUED;

- no marcar FAILED automáticamente.



## 29.1 Edición



Mientras exista un intento activo incompatible:



- bloquear edición fiscal;

- explicar por qué.



Después de `ISSUED`:



la factura es de solo lectura dentro del flujo normal.



---



# 30. Perfil Fiscal y Clientes: experiencia final



Los cambios de Fase 5C deben mantener una experiencia consistente entre:



- Perfil Fiscal;

- Clientes.



## 30.1 Perfil Fiscal



Orden de la pantalla:



1. título y explicación;

2. opción de subir Constancia de Situación Fiscal;

3. autorización de lectura;

4. resultado de extracción;

5. formulario fiscal;

6. confirmación de datos;

7. guardar cambios.



La Constancia aparece ANTES del formulario.



Si no se carga Constancia:



el usuario puede completar manualmente el formulario.



El régimen fiscal utiliza selector:



`Código · Descripción`



No campo de texto libre.



Después de guardar:



mostrar un estado visual con icono de palomita y:



`Información guardada correctamente`



## 30.2 Clientes



Para crear o editar un cliente:



- RFC;

- razón social/nombre;

- código postal;

- régimen fiscal;

- Uso CFDI;



forman parte del núcleo fiscal soportado.



La Constancia del cliente:



- es opcional;

- puede cargarse para autocompletar;

- aparece como herramienta recomendada;

- no se presenta como requisito legal obligatorio.



Si se carga:



- solicitar declaración correspondiente;

- procesar después de aceptar;

- autocompletar;

- permitir corrección;

- pedir confirmación.



El régimen se muestra como:



`Código · Descripción`



Uso CFDI se selecciona desde su catálogo independiente.



## 30.3 Campos autocompletados



La interfaz debe diferenciar visualmente cuando sea útil:



- detectado automáticamente;

- modificado por usuario;

- pendiente de revisión.



No bloquear la corrección manual de un campo detectado.



La confirmación final siempre corresponde a los valores visibles después de las correcciones.



---



# 31. Navegación y comportamiento visual



Estos ajustes son funcionales y forman parte de Fase 5C.



No constituyen el rediseño visual completo de ORBIT.



## 31.1 Sidebar desktop



La barra lateral conserva el comportamiento expandible existente.



Cuando está expandida debe contraerse automáticamente cuando:



- el usuario selecciona una opción de navegación;

- el usuario hace clic fuera del sidebar.



No debe contraerse mientras el usuario está interactuando con:



- acordeones;

- botones internos;

- controles necesarios dentro del sidebar;



salvo cuando esa acción provoca navegación.



## 31.2 Altura del sidebar



El sidebar no debe ocupar una altura que oculte:



- banner de cookies;

- controles de privacidad;

- elementos críticos inferiores.



Debe existir espacio inferior suficiente.



Usar una estrategia responsive basada en viewport.



No solucionar únicamente con un valor fijo que falle en otros tamaños de pantalla.



Debe probarse como mínimo en:



- 1440 px;

- 1280 px;

- 820 px;

- 390 px;

- 360 px.



## 31.3 Banner de cookies



El banner de cookies debe permanecer:



- visible;

- legible;

- clickeable;

- por encima de elementos que puedan interferir.



Sidebar y cookies no deben impedir mutuamente sus controles.



## 31.4 Barra superior



La barra superior debe conservar legibilidad mientras el usuario hace scroll.



Aplicar efecto glass equivalente a:



- fondo semitransparente;

- `backdrop-filter: blur(...)`;

- borde/sombra sutil cuando corresponda.



El contenido detrás puede percibirse de forma difuminada.



El texto y los controles de la barra deben mantener contraste suficiente.



No utilizar un blur que vuelva ilegible:



- breadcrumb;

- título;

- botones;

- acciones.



## 31.5 Responsive y accesibilidad



Estos cambios deben respetar:



- navegación por teclado;

- focus visible;

- Escape cuando corresponda;

- `prefers-reduced-motion`;

- ARIA existente;

- ausencia de overflow horizontal.



El comportamiento mobile existente no debe degradarse.



---



# 32. Ownership de Claude



Claude tiene ownership principal de Fase 5C backend.



Incluye:



- modelos Prisma necesarios;

- migraciones;

- CSF extraction backend;

- almacenamiento de resultados detectados;

- consentimiento y auditoría;

- catálogos fiscales;

- validaciones fiscales;

- CSD validation;

- cifrado y custodia de CSD;

- signing service;

- XML CFDI 4.0;

- XSD;

- XSLT/cadena original;

- validación criptográfica;

- StampAttempt;

- idempotencia;

- PacProvider;

- adaptador SW;

- sandbox PAC;

- reconciliación;

- almacenamiento XML/PDF;

- transición READY -> ISSUED;

- seguridad de red;

- APIs;

- tests backend/E2E fiscales.



Claude NO debe:



- rediseñar Invoice Studio;

- cambiar arbitrariamente componentes visuales propiedad de Codex;

- modificar el contrato compartido silenciosamente;

- utilizar producción durante implementación inicial;

- guardar secretos reales en repositorio.



---



# 33. Ownership de Codex



Codex tiene ownership principal de Fase 5C frontend/UX.



Incluye:



- Perfil Fiscal;

- flujo visual de carga de CSF;

- consentimientos;

- autocompletado;

- revisión de datos;

- selector de régimen;

- Clientes;

- flujo opcional de CSF de clientes;

- selector de Uso CFDI;

- UI de configuración de CSD;

- estados seguros de CSD;

- revisión final de CFDI;

- autorización de timbrado;

- estados visuales del StampAttempt;

- errores PAC;

- estado UNKNOWN;

- resultado ISSUED;

- descarga XML/PDF;

- responsive;

- accesibilidad;

- comportamiento del sidebar;

- altura del sidebar;

- topbar glass.



Codex NO debe:



- implementar criptografía propia;

- guardar secretos;

- tocar migraciones salvo autorización expresa;

- duplicar validaciones fiscales del backend;

- inventar respuestas PAC;

- convertir un mock en ISSUED.



Frontend consume contratos server-side.



Backend sigue siendo autoridad fiscal.



---



# 34. Archivos compartidos y coordinación



Claude y Codex pueden necesitar tipos compartidos.



La fuente compartida debe mantenerse en archivos explícitamente neutrales, por ejemplo:



`src/types/...`



Antes de modificar un archivo que pertenece al ownership del otro agente:



1. detenerse;

2. identificar la necesidad;

3. reportar el cambio;

4. acordar contrato.



No editar simultáneamente el mismo archivo desde dos worktrees.



## 34.1 Orden recomendado



Fase 5C se divide inicialmente:



### Claude



`Fase 5C-A · Fiscal Identity + PAC Foundation`



### Codex



`Fase 5C-B · Fiscal UX`



Codex puede construir contra el contrato compartido mientras Claude implementa backend.



Después:



1. integrar Claude;

2. actualizar Codex desde main;

3. Codex conecta backend real;

4. regresión conjunta.



Mismo patrón utilizado exitosamente en Fase 5A/5B.



## 34.2 Git



Durante implementación:



- no trabajar directamente en main;

- no hacer force push;

- no hacer producción desde worktrees;

- no ejecutar migraciones Neon desde ramas de agente;

- no hacer deploy sin aprobación.



Los agentes no hacen merge a main por su cuenta.



---



# 35. Pruebas obligatorias



Fase 5C NO está completa únicamente porque la UI funcione.



Debe probarse seguridad, fiscalidad, concurrencia y fallos.



## 35.1 CSF



Tests mínimos:



- PDF válido;

- PDF inválido;

- procesamiento sin consentimiento bloqueado;

- múltiples regímenes;

- dato ambiguo;

- dato ausente;

- cambio contra datos previamente confirmados;

- aislamiento tenant;

- captura manual funcionando.



## 35.2 CSD



Tests mínimos:



- `.cer` válido de prueba;

- `.key` válida de prueba;

- contraseña correcta;

- contraseña incorrecta;

- llave que no corresponde al certificado;

- certificado vencido;

- RFC incompatible;

- cross-tenant bloqueado;

- material sensible ausente de logs/respuestas.



## 35.3 CFDI



Tests mínimos:



- XML estructuralmente válido;

- validación XSD;

- cadena original;

- firma verificable;

- totales exactos;

- impuestos;

- descuentos;

- retenciones;

- snapshots;

- rechazo de datos modificados después de READY.



## 35.4 PAC



Tests sandbox:



- timbrado exitoso;

- rechazo explícito;

- timeout antes de submit;

- timeout ambiguo después de submit;

- UNKNOWN;

- reconciliación;

- doble clic;

- request duplicado;

- respuesta corrupta;

- XML sin timbre;

- UUID inconsistente;

- RFC inconsistente;

- total inconsistente.



## 35.5 Seguridad



Mantener:



- `security:check`;

- tenant isolation;

- origin/CSRF protections cuando corresponda;

- rate limiting;

- límites de body;

- SSRF protections;

- sanitización de errores.



## 35.6 Regresión



Antes de producción deben pasar:



- lint;

- typecheck;

- unit tests;

- build;

- Fase 3 E2E;

- Fase 4 E2E;

- Fase 5A/5B E2E;

- Fase 5C E2E;

- responsive;

- accesibilidad;

- `git diff --check`.



Los tests fiscales nunca utilizan Neon producción.



---



# 36. Rollout y producción



Fase 5C debe desplegarse progresivamente.



No pasar directamente de mocks a timbrado general para todos los usuarios.



## 36.1 Etapa 1



Desarrollo local:



- certificados de prueba;

- datos sintéticos;

- provider fake únicamente en tests;

- sin producción.



## 36.2 Etapa 2



Sandbox del PAC:



- credenciales sandbox;

- escenarios reales del proveedor;

- reconciliación;

- errores;

- XML de prueba.



Todo resultado debe identificarse como:



`SANDBOX`



## 36.3 Etapa 3



Preparación productiva:



Antes de activar producción:



- verificar autorización vigente del PAC;

- revisar contrato comercial;

- disponer de credenciales productivas;

- revisar Aviso de Privacidad;

- revisar términos aplicables;

- validar infraestructura de secretos;

- backup Neon;

- aplicar migraciones;

- ejecutar regresión completa.



## 36.4 Etapa 4



Piloto controlado:



Activar timbrado real únicamente para una Organization controlada.



Verificar:



- CSD real;

- emisión real;

- XML;

- UUID;

- almacenamiento;

- PDF;

- descargas;

- auditoría;

- PAC;

- consulta/verificación posterior cuando corresponda.



No habilitar masivamente antes de aprobar el piloto.



## 36.5 Activación general



Solo después del piloto:



habilitar a Organizations elegibles.



La activación puede utilizar:



- feature flag;

- entitlement;

- configuración server-side;



para evitar una liberación accidental.



## 36.6 Fuera de alcance inmediato



Fase 5C NO obliga a implementar todavía:



- cancelaciones;

- sustituciones;

- Complemento de Pago;

- Nómina;

- Carta Porte;

- Comercio Exterior;

- facturación global;

- Egreso completo;

- Traslado completo;

- automatización fiscal sin intervención;

- múltiples PAC activos simultáneamente por usuario.



Estas capacidades tendrán fases propias.



---



# 37. Definition of Done y cambios de contrato



Fase 5C se considera terminada únicamente cuando:



- CSF del emisor funciona con consentimiento;

- autocompletado funciona;

- régimen fiscal usa catálogo;

- Clientes soportan CSF opcional;

- datos de terceros requieren declaración;

- CSD puede configurarse de forma segura;

- CSD se valida;

- llave privada se almacena cifrada;

- contraseña no queda persistida;

- XML CFDI 4.0 se construye correctamente;

- cadena original se genera correctamente;

- firma CSD se verifica;

- PacProvider está desacoplado;

- SW sandbox funciona;

- idempotencia está probada;

- UNKNOWN está resuelto correctamente;

- respuesta PAC se valida;

- ningún mock puede generar ISSUED productivo;

- XML timbrado se almacena privado;

- PDF puede generarse;

- navegación solicitada funciona;

- responsive y accesibilidad pasan;

- regresión completa pasa;

- producción permanece deshabilitada hasta cumplir los gates definidos.



## 37.1 Cambio de contrato



Si Claude o Codex consideran necesario cambiar:



- tipos compartidos;

- estados;

- rutas;

- ownership;

- semántica fiscal;

- seguridad;

- flujo PAC;

- manejo del CSD;

- consentimiento;

- transición READY -> ISSUED;



deben detenerse y reportarlo.



No modificar silenciosamente este documento.



## 37.2 Prioridad ante conflicto



Si existe conflicto entre:



1. comodidad de UX;

2. velocidad de desarrollo;

3. seguridad;

4. integridad fiscal;



la prioridad será:



`seguridad e integridad fiscal`



Una operación que no pueda demostrarse segura y fiscalmente consistente:



`NO SE EJECUTA`



---
