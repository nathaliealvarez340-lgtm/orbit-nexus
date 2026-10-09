"use client";
export function FiscalConfirmation({
  client = false,
  checked,
  onChange,
  disabled = false,
}: {
  client?: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="fiscal-check mt-6">
      <input
        type="checkbox"
        name="confirmed"
        required
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {client
          ? "Revisé y confirmo que los datos fiscales del cliente son correctos."
          : "Revisé y confirmo que mis datos fiscales son correctos."}
      </span>
    </label>
  );
}
