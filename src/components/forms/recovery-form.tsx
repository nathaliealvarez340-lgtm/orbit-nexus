"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { passwordSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
export function RecoveryForm({ token }: { token?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const data = new FormData(e.currentTarget);
        const password = String(data.get("password"));
        if (
          token &&
          (!passwordSchema.safeParse(password).success ||
            password !== data.get("confirm"))
        ) {
          setMessage(
            "Usa 12 caracteres, mayúscula, minúscula y número. Ambas contraseñas deben coincidir.",
          );
          return;
        }
        setBusy(true);
        setMessage("");
        try {
          const result = token
            ? await authClient.resetPassword({ token, newPassword: password })
            : await authClient.requestPasswordReset({
                email: String(data.get("email")),
                redirectTo: "/reset-password",
              });
          setMessage(
            result.error
              ? "No fue posible completar la solicitud. El enlace puede haber expirado o el correo aún no está habilitado."
              : token
                ? "Contraseña actualizada. Ya puedes iniciar sesión."
                : "Si existe una cuenta con este correo, recibirás instrucciones para recuperar el acceso.",
          );
        } catch {
          setMessage("No pudimos conectar. Intenta más tarde.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {token ? (
        <>
          <label className="block text-sm text-zinc-400">
            Nueva contraseña
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              className="input mt-2"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label className="block text-sm text-zinc-400">
            Confirmar contraseña
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              className="input mt-2"
              required
            />
          </label>
        </>
      ) : (
        <label className="block text-sm text-zinc-400">
          Correo
          <input
            name="email"
            type="email"
            autoComplete="email"
            className="input mt-2"
            required
          />
        </label>
      )}
      <Button
        type="submit"
        disabled={busy}
        className="w-full disabled:opacity-50"
      >
        {busy
          ? "Procesando…"
          : token
            ? "Actualizar contraseña"
            : "Solicitar recuperación"}
      </Button>
      <p role="status" className="text-sm text-zinc-400">
        {message}
      </p>
    </form>
  );
}
