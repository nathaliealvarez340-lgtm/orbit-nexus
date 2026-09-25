# Prevención de secretos

Ejecutar `npm run security:check` antes de preparar o publicar cambios. `npm run validate`
ejecuta este control, lint, typecheck, tests y build, una vez cada uno. El comando existente
`npm run check:auth-env` también ejecuta primero el control mediante `precheck:auth-env`;
después valida las variables del entorno de ejecución. No se instalaron hooks.

## Alcance del control

- Inspecciona el índice Git (incluidos archivos staged aunque estén borrados o limpios en
  el working tree), las copias locales de archivos tracked y archivos nuevos no ignorados.
- Exige que `.env.example` permanezca en el índice. Solo permite valores vacíos,
  placeholders explícitos como `<GENERATE_RANDOM_SECRET>` o `YOUR_API_KEY`, y localhost
  para `BETTER_AUTH_URL`. No permite conexiones con credenciales en la plantilla.
- Rechaza archivos de entorno reales, claves privadas, contenedores de certificados,
  dumps, backups, logs y determinados archivos de credenciales/estado de herramientas.
- Detecta conexiones de base de datos con credenciales, claves privadas, JWT, patrones
  de proveedores y asignaciones literales a variables sensibles, incluidas Better Auth,
  contraseñas, API keys y secretos OAuth.
- Mantiene las migraciones `prisma/migrations/**/migration.sql` visibles y revisa también
  su contenido. No ejecuta migraciones ni conecta con ningún servicio.
- Solo comunica archivo y categoría de riesgo. Devuelve 1 ante hallazgos o si no puede
  completar la inspección; devuelve 0 al pasar.

No carga `.env`, no lee archivos locales ignorados salvo que estén en el índice, no
modifica Git y no imprime valores. Necesita un checkout con metadatos Git: ejecutar la
validación antes de preparar un archivo de distribución que no incluya `.git`.

Las únicas excepciones de contenido son fingerprints de contraseñas sintéticas ya
existentes en pruebas y dos conexiones locales de desarrollo, acotados a sus archivos.
No se excluyen carpetas completas de tests ni las migraciones. Para cambiar una excepción,
revisar que el valor sea sintético y no se use como credencial fuera de pruebas.

Es un detector preventivo de patrones, no una garantía contra secretos ofuscados,
cifrados, divididos entre expresiones o contenidos en archivos comprimidos. No audita el
historial ni objetos remotos de Git LFS. Complementarlo con revisión humana y GitHub.
`npm run build` por sí solo no sustituye `npm run validate`.

## Archivos ignorados

`.env*`, `*.env` y `*.env.*` quedan ignorados, salvo `.env.example`. También claves y
certificados privados, dumps SQL (con excepción de las migraciones), respaldos simples o
comprimidos, logs, credenciales JSON descargadas, archivos temporales `secrets*` y estado
local de herramientas. No forzar la incorporación de estos archivos al índice.

## GitHub: configuración manual recomendada

Un administrador debe revisar **Settings → Security and quality → Advanced Security**
(los nombres pueden variar según la interfaz y el plan), sin publicar valores secretos:

1. **Secret scanning**: habilitarlo donde esté disponible; revisar sus alertas y patrones
   de detección. Es gratuito para repositorios públicos; en repositorios privados de
   organizaciones puede requerir GitHub Secret Protection y un plan compatible.
2. **Push protection**: habilitar la protección del repositorio para bloquear secretos
   soportados antes de aceptar un push. Revisar las excepciones/bypass que se autoricen.
3. **Dependency graph** y **Dependabot alerts**: habilitarlos para recibir avisos sobre
   dependencias vulnerables.
4. **Dependabot security updates**: habilitarlo para que GitHub abra PR con correcciones
   de vulnerabilidades. Revisar y validar esos PR; esto no habilita auto-merge ni equivale
   a actualizaciones periódicas de todas las versiones.

No se ha cambiado ninguna configuración remota como parte de este hardening.

Fuentes oficiales:

- [Activar secret scanning](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning)
- [Configuración de seguridad del repositorio](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)
- [Dependabot security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/configuring-dependabot-security-updates)
