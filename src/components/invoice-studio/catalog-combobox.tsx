"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { CatalogOption } from "@/types/invoice-studio";
import { readCatalog, studioRequest } from "./transport";

const emptyOptions: CatalogOption[] = [];
export function CatalogCombobox({
  label,
  value,
  onChange,
  options = emptyOptions,
  endpoint,
  loadOptions,
  help,
  error,
  field,
  conceptIndex,
  showCode = true,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options?: CatalogOption[];
  endpoint?: string;
  loadOptions?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<CatalogOption[]>;
  help?: string;
  error?: string;
  field?: string;
  conceptIndex?: number;
  showCode?: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<{
    query: string;
    options: CatalogOption[];
    error?: string;
    loading: boolean;
    complete?: boolean;
  }>({ query: "", options: [], loading: false });
  const [picked, setPicked] = useState<CatalogOption>();
  const selected =
    options.find((option) => option.code === value) ??
    (picked?.code === value ? picked : undefined);
  const display = selected
    ? showCode
      ? `${selected.code} · ${selected.label}`
      : selected.label
    : value
      ? `${value} · Pendiente de verificar`
      : "";
  const isRemote = !!endpoint || !!loadOptions;
  const filtered = isRemote
    ? remote.query === query
      ? remote.options
      : emptyOptions
    : options
        .filter((option) =>
          `${option.code} ${option.label}`
            .toLocaleLowerCase("es")
            .includes(query.toLocaleLowerCase("es")),
        )
        .slice(0, 30);
  const busy = isRemote && (remote.query !== query || remote.loading);
  // Resolve persisted SAT codes through the same source used for search. A saved
  // code has no label in the detail DTO; never substitute a client-side catalog.
  useEffect(() => {
    if (!endpoint || !value || picked?.code === value) return;
    const controller = new AbortController();
    studioRequest(`${endpoint}?q=${encodeURIComponent(value)}&limit=30`, {
      signal: controller.signal,
    })
      .then(readCatalog)
      .then((catalog) => {
        if (!controller.signal.aborted)
          setPicked(catalog.results.find((option) => option.code === value));
      })
      .catch(() => {
        // Keep the code visible. Its fiscal status still comes from validation.
      });
    return () => controller.abort();
  }, [endpoint, value, picked?.code]);
  useEffect(() => {
    if (!open || (!endpoint && !loadOptions)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRemote({ query, options: [], loading: true });
      try {
        const catalog = endpoint
          ? readCatalog(
              await studioRequest(
                `${endpoint}?q=${encodeURIComponent(query)}&limit=30`,
                { signal: controller.signal },
              ),
            )
          : undefined;
        const result =
          catalog?.results ?? (await loadOptions!(query, controller.signal));
        if (!controller.signal.aborted)
          setRemote({
            query,
            options: result,
            loading: false,
            complete: catalog?.complete,
          });
      } catch (failure) {
        if (!controller.signal.aborted)
          setRemote({
            query,
            options: [],
            loading: false,
            error: (failure as Error).message,
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, endpoint, loadOptions, open]);
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  function choose(option: CatalogOption) {
    if (!option.active) return;
    setPicked(option);
    onChange(option.code);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }
  return (
    <div className="studio-field studio-combobox">
      <label htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          ref={input}
          role="combobox"
          className="input pr-10"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-activedescendant={
            open && active >= 0 && filtered[active]
              ? `${id}-option-${active}`
              : undefined
          }
          aria-invalid={!!error}
          aria-describedby={id + "-help"}
          autoComplete="off"
          data-field={field}
          data-concept-index={conceptIndex}
          value={open ? query : display}
          placeholder={
            showCode ? "Buscar código o descripción…" : "Buscar por nombre…"
          }
          onFocus={() => {
            setQuery("");
            setOpen(true);
            setActive(-1);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(-1);
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const direction = event.key === "ArrowDown" ? 1 : -1;
              let next = active;
              for (let i = 0; i < filtered.length; i++) {
                next = (next + direction + filtered.length) % filtered.length;
                if (filtered[next]?.active) {
                  setActive(next);
                  break;
                }
              }
            }
            if (event.key === "Enter" && open) {
              event.preventDefault();
              if (filtered[active]?.active) choose(filtered[active]);
            }
          }}
        />
        <ChevronDown
          className="pointer-events-none absolute right-3 top-3 size-4 text-zinc-400"
          aria-hidden="true"
        />
      </div>
      {open && (
        <div className="studio-options-panel">
          <div className="flex items-center gap-2 border-b border-white/10 p-3 text-xs text-zinc-400">
            <Search className="size-3" aria-hidden="true" />
            {showCode ? "Código o descripción" : "Nombre o descripción"}
          </div>
          <ul
            id={id + "-list"}
            role="listbox"
            aria-label={label}
            className="studio-options-list"
          >
            {filtered.map((option, index) => (
              <li
                key={option.code}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.code === value}
                aria-disabled={!option.active}
                data-highlighted={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {showCode && (
                  <span className="font-mono text-xs">{option.code}</span>
                )}
                <span>
                  {option.label}
                  {!option.active ? " · No disponible" : ""}
                </span>
              </li>
            ))}
          </ul>
          {busy && (
            <p className="p-3 text-sm text-zinc-400" role="status">
              Buscando…
            </p>
          )}
          {!busy && !filtered.length && (
            <p className="p-3 text-sm text-zinc-400" role="status">
              {remote.error ??
                (remote.complete === false
                  ? "Sin coincidencias en la cobertura disponible. El catálogo SAT completo aún no está cargado."
                  : "Sin coincidencias. Prueba otro código o descripción.")}
            </p>
          )}
          {remote.complete === false && !!filtered.length && (
            <p className="p-3 text-xs text-zinc-400">
              Cobertura parcial del catálogo SAT. El servidor verifica las
              claves disponibles.
            </p>
          )}
        </div>
      )}
      <p id={id + "-help"} className={error ? "studio-error" : "studio-help"}>
        {error ?? help ?? "Selecciona una opción de los resultados."}
      </p>
    </div>
  );
}
