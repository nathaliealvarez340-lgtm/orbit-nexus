import "dotenv/config";
import { authOrigin } from "../src/lib/auth-origin.ts";
const issues = [];
try {
  authOrigin({ ...process.env, NODE_ENV: "production" });
} catch {
  issues.push(
    "BETTER_AUTH_URL: configura el origen HTTPS exacto, sin ruta, query ni credenciales.",
  );
}
if (
  !process.env.BETTER_AUTH_SECRET ||
  process.env.BETTER_AUTH_SECRET.trim().length < 32
)
  issues.push(
    "BETTER_AUTH_SECRET: configura un secreto aleatorio de al menos 32 caracteres.",
  );
try {
  const url = new URL(process.env.DATABASE_URL || "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new Error();
} catch {
  issues.push(
    "DATABASE_URL: configura una URL PostgreSQL válida con nombre de base.",
  );
}
if (issues.length) {
  issues.forEach((message) => console.error(message));
  process.exitCode = 1;
} else
  console.log(
    "Configuración de autenticación válida en formato. Valores ocultos. Falta comprobar conectividad y migraciones de la base.",
  );
