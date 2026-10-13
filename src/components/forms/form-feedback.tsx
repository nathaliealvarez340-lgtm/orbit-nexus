"use client";
import { useEffect, useId, useRef, type RefObject } from "react";
import { useExperience } from "@/components/experience/experience-provider";
// Common live feedback. Field keys come from backend validation, never its raw
// message/SQL/stack. Existing field descriptions are preserved.
export function FormFeedback({
  message,
  error = false,
  busy = false,
  fields = [],
  scope,
}: {
  message: string;
  error?: boolean;
  busy?: boolean;
  fields?: string[];
  scope?: RefObject<HTMLElement | null>;
}) {
  const { t } = useExperience();
  const id = useId(),
    feedback = useRef<HTMLParagraphElement>(null);
  const keys = JSON.stringify(fields);
  useEffect(() => {
    if (!error || !message) return;
    const root = scope?.current ?? feedback.current?.closest("form, section");
    const marked: {
      node: HTMLElement;
      description: string | null;
      invalid: string | null;
    }[] = [];
    for (const key of JSON.parse(keys) as string[]) {
      const node = root?.querySelector<HTMLElement>(
        `[name="${CSS.escape(key)}"]:not([type="hidden"]), [data-field="${CSS.escape(key)}"]`,
      );
      if (!node) continue;
      marked.push({
        node,
        description: node.getAttribute("aria-describedby"),
        invalid: node.getAttribute("aria-invalid"),
      });
      node.setAttribute("aria-invalid", "true");
      node.setAttribute(
        "aria-describedby",
        `${node.getAttribute("aria-describedby") || ""} ${id}`.trim(),
      );
    }
    (marked[0]?.node ?? feedback.current)?.focus();
    return () => {
      for (const { node, description, invalid } of marked) {
        if (description === null) node.removeAttribute("aria-describedby");
        else node.setAttribute("aria-describedby", description);
        if (invalid === null) node.removeAttribute("aria-invalid");
        else node.setAttribute("aria-invalid", invalid);
      }
    };
  }, [message, error, keys, id, scope]);
  if (!message && !busy) return null;
  return (
    <p
      ref={feedback}
      id={id}
      tabIndex={-1}
      role={error ? "alert" : "status"}
      aria-atomic="true"
      className="form-feedback"
      data-state={
        busy
          ? "submitting"
          : error
            ? fields.length
              ? "field-error"
              : "error"
            : message
              ? "success"
              : "idle"
      }
    >
      {busy ? t("common", "processing") : message}
    </p>
  );
}
