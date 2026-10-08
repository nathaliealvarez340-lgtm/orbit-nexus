import type { InputHTMLAttributes, ReactNode } from "react";
import { useId, useState } from "react";
import type { CatalogOption } from "@/types/invoice-studio";
import { shiftDecimal } from "./model";

export function StudioSection({
  id,
  step,
  title,
  copy,
  children,
  action,
}: {
  id: string;
  step: string;
  title: string;
  copy?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section id={id} className="studio-card" aria-labelledby={id + "-title"}>
      <div className="studio-section-heading">
        <div className="flex min-w-0 items-start gap-3">
          <span className="studio-step" aria-hidden="true">
            {step}
          </span>
          <div>
            <h2 id={id + "-title"} className="font-semibold">
              {title}
            </h2>
            {copy && <p className="mt-1 text-sm text-zinc-400">{copy}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="studio-section-content">{children}</div>
    </section>
  );
}
type FieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> & {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  help?: string;
  field?: string;
  conceptIndex?: number;
  suffix?: string;
};
export function PercentField(props: FieldProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const display = shiftDecimal(props.value ?? "", 2);
  return (
    <StudioField
      {...props}
      suffix="%"
      value={editing ?? display}
      onFocus={() => setEditing(display)}
      onBlur={() => setEditing(null)}
      onChange={(value) => {
        setEditing(value);
        props.onChange(shiftDecimal(value, -2));
      }}
    />
  );
}
export function StudioField({
  label,
  value,
  onChange,
  error,
  help,
  field,
  conceptIndex,
  suffix,
  ...props
}: FieldProps) {
  const generated = useId(),
    id = props.id ?? generated;
  return (
    <div className="studio-field">
      <label htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          {...props}
          id={id}
          className="input"
          data-field={field}
          data-concept-index={conceptIndex}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={error || help ? id + "-help" : undefined}
        />
        {suffix && (
          <span className="studio-input-suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {(error || help) && (
        <p id={id + "-help"} className={error ? "studio-error" : "studio-help"}>
          {error ?? help}
        </p>
      )}
    </div>
  );
}
export function StudioSelect({
  label,
  value,
  options,
  onChange,
  error,
  field,
  conceptIndex,
  help,
  disabled,
}: {
  label: string;
  value?: string;
  options: CatalogOption[];
  onChange: (value: string) => void;
  error?: string;
  field?: string;
  conceptIndex?: number;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="studio-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={value ?? ""}
        disabled={disabled}
        data-field={field}
        data-concept-index={conceptIndex}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={error || help ? id + "-help" : undefined}
      >
        <option value="">Seleccionar…</option>
        {value && !options.some((option) => option.code === value) && (
          <option value={value}>{value} · Pendiente de verificar</option>
        )}
        {options.map((option) => (
          <option
            key={option.code}
            value={option.code}
            disabled={!option.active}
          >
            {option.code} · {option.label}
            {!option.active ? " · No disponible" : ""}
          </option>
        ))}
      </select>
      {(error || help) && (
        <p id={id + "-help"} className={error ? "studio-error" : "studio-help"}>
          {error ?? help}
        </p>
      )}
    </div>
  );
}
