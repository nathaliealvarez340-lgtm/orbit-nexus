"use client";
import { PasswordInput } from "@/components/ui/password-input";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { passwordSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "./form-feedback";
export function RecoveryForm({ token }: { token?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false),
    [fields, setFields] = useState<string[]>([]);
  const lock = useRef(false);
  return (
    <form
      className="mt-6 space-y-4"
      aria-busy={busy}
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        setFailed(false);
        setFields([]);
        const data = new FormData(e.currentTarget);
        const password = String(data.get("password"));
        if (
          token &&
          (!passwordSchema.safeParse(password).success ||
            password !== data.get("confirm"))
        ) {
          setFailed(true);
          setFields(["password", "confirm"]);
          setMessage(
            "Usa 12 caracteres, mayúscula, minúscula y número. Ambas contraseñas deben coincidir.",
          );
          return;
        }
        lock.current = true;
        setBusy(true);
        setMessage("");
        try {
          const result = token
            ? await authClient.resetPassword({ token, newPassword: password })
            : await authClient.requestPasswordReset({
                email: String(data.get("email")),
                redirectTo: "/reset-password",
              });
          setFailed(!!result.error);
          setMessage(
            result.error
              ? "No fue posible completar la solicitud. El enlace puede haber expirado o el correo aún no está habilitado."
              : token
                ? "Contraseña actualizada. Ya puedes iniciar sesión."
                : "Si existe una cuenta con este correo, recibirás instrucciones para recuperar el acceso.",
          );
        } catch {
          setFailed(true);
          setMessage("No pudimos conectar. Intenta más tarde.");
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      {token ? (
        <>
          <label className="block text-sm text-zinc-400">
            Nueva contraseña
            <PasswordInput
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
            <PasswordInput
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
      <FormFeedback
        message={message}
        error={failed}
        busy={busy}
        fields={fields}
      />
    </form>
  );
}
