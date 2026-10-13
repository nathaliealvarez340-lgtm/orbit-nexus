"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useExperience } from "@/components/experience/experience-provider";
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useExperience();
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={(props.className ?? "input") + " !pr-12"}
      />
      <button
        type="button"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-3"
        aria-label={t("common", visible ? "hidePasswordLabel" : "showPasswordLabel")}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}
