import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { getDb } from "./db";
import { passwordSchema } from "./validation";
import { z } from "zod";
import { authOrigin } from "./auth-origin";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_NOT_CONFIGURED");
  const baseURL = authOrigin();
  return betterAuth({
    appName: "ORBIT NEXUS",
    baseURL,
    secret,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    trustedOrigins: [new URL(baseURL).origin],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!process.env.MAIL_API_URL || !process.env.MAIL_API_TOKEN)
          throw new Error("MAIL_NOT_CONFIGURED");
        // Contract for the deployment's trusted transactional mail service.
        const response = await fetch(process.env.MAIL_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MAIL_API_TOKEN}`,
          },
          body: JSON.stringify({
            to: user.email,
            template: "orbit-password-reset",
            url,
          }),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        if (!response.ok) throw new Error("MAIL_UNAVAILABLE");
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/sign-up/email" &&
          !z.string().trim().min(2).max(100).safeParse(ctx.body?.name).success
        )
          throw new APIError("BAD_REQUEST", {
            message: "Escribe un nombre de entre 2 y 100 caracteres.",
          });
        if (
          ["/sign-up/email", "/reset-password", "/change-password"].includes(
            ctx.path,
          )
        ) {
          const password = ctx.body?.newPassword ?? ctx.body?.password;
          if (!passwordSchema.safeParse(password).success)
            throw new APIError("BAD_REQUEST", {
              message:
                "Usa 12 caracteres o más, mayúscula, minúscula y número.",
            });
        }
        if (
          ctx.path === "/request-password-reset" &&
          (!process.env.MAIL_API_URL || !process.env.MAIL_API_TOKEN)
        )
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "La recuperación por correo aún no está configurada.",
          });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const membership = await getDb().membership.findFirst({
              where: { userId: session.userId },
              orderBy: { createdAt: "asc" },
            });
            if (membership)
              await getDb().activityLog.create({
                data: {
                  organizationId: membership.organizationId,
                  userId: session.userId,
                  action: "LOGIN",
                  entityType: "Session",
                },
              });
          },
        },
      },
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth());
}
