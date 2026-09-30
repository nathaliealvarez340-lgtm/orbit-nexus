"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { passwordSchema } from "@/lib/validation";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
export function UserSettings({
  name,
  email,
  accent,
}: {
  name: string;
  email: string;
  accent: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form
        className="surface space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const values = new FormData(e.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const result = await authClient.updateUser({
              name: String(values.get("name")).trim(),
            });
            if (result.error)
              throw new Error("No se pudo actualizar el nombre.");
            const response = await fetch("/api/user/preferences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accent: values.get("accent") }),
            });
            if (!response.ok) throw new Error("No se pudo guardar el color.");
            setMessage("Preferencias guardadas.");
            router.refresh();
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-medium">Mi cuenta</h2>
        <label className="block text-sm">
          Nombre
          <input
            className="input mt-2"
            name="name"
            defaultValue={name}
            required
            minLength={2}
            maxLength={100}
          />
        </label>
        <p className="break-all text-sm text-zinc-400">Correo: {email}</p>
        <label className="block text-sm">
          Color de acento
          <select name="accent" defaultValue={accent} className="input mt-2">
            <option value="PURPLE">Morado</option>
            <option value="BLUE">Azul</option>
            <option value="ORANGE">Naranja</option>
            <option value="RED">Rojo</option>
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          Guardar preferencias
        </Button>
      </form>
      <form
        className="surface space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = e.currentTarget,
            values = new FormData(form),
            currentPassword = String(values.get("current")),
            newPassword = String(values.get("new"));
          const validation = passwordSchema.safeParse(newPassword);
          if (!validation.success || newPassword !== values.get("confirm")) {
            setMessage(
              "Usa 12 caracteres, mayúscula, minúscula y número; confirma la misma contraseña.",
            );
            return;
          }
          setBusy(true);
          setMessage("");
          try {
            const result = await authClient.changePassword({
              currentPassword,
              newPassword,
              revokeOtherSessions: true,
            });
            if (result.error)
              throw new Error(
                "Revisa la contraseña actual e intenta nuevamente.",
              );
            form.reset();
            setMessage(
              "Contraseña actualizada. Las otras sesiones se cerraron.",
            );
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-medium">Cambiar contraseña</h2>
        {[
          ["current", "Contraseña actual", "current-password"],
          ["new", "Nueva contraseña", "new-password"],
          ["confirm", "Confirmar nueva contraseña", "new-password"],
        ].map(([field, label, autoComplete]) => (
          <label key={field} className="block text-sm">
            {label}
            <PasswordInput
              name={field}
              autoComplete={autoComplete}
              required
              maxLength={128}
              className="input mt-2"
            />
          </label>
        ))}
        <Button type="submit" disabled={busy}>
          Actualizar contraseña
        </Button>
      </form>
      <p className="text-sm text-violet-300 xl:col-span-2" role="status">
        {message}
      </p>
    </div>
  );
}
