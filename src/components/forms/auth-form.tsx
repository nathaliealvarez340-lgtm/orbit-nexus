"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";

const schema = z.object({
  name: z.string().min(2).optional(),
  email: z.email("Ingresa un correo válido"),
  password: z.string().min(8, "Usa al menos 8 caracteres"),
  confirm: z.string().optional(),
}).refine((data) => !data.confirm || data.password === data.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });

type Values = z.infer<typeof schema>;

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { register, handleSubmit, formState: { errors, isSubmitSuccessful } } = useForm<Values>({ resolver: zodResolver(schema) });
  return (
    <form onSubmit={handleSubmit(() => undefined)} className="mt-8 space-y-4">
      {mode === "register" && <Field label="Nombre" error={errors.name?.message}><input {...register("name")} className="input" placeholder="Tu nombre" /></Field>}
      <Field label="Correo" error={errors.email?.message}><input {...register("email")} className="input" type="email" placeholder="nombre@empresa.com" /></Field>
      <Field label="Contraseña" error={errors.password?.message}><input {...register("password")} className="input" type="password" placeholder="••••••••" /></Field>
      {mode === "register" && <Field label="Confirmar contraseña" error={errors.confirm?.message}><input {...register("confirm")} className="input" type="password" placeholder="••••••••" /></Field>}
      <Button type="submit" className="h-11 w-full">{mode === "login" ? "Iniciar sesión" : "Crear cuenta"} <ArrowRight className="size-4" /></Button>
      {isSubmitSuccessful && <p className="text-center text-xs text-emerald-400">Demo validada correctamente. La autenticación real se conectará después.</p>}
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm text-zinc-400">{label}<div className="mt-2">{children}</div>{error && <span className="mt-1 block text-xs text-red-400">{error}</span>}</label>;
}

