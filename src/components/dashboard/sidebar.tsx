"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { PanelLeftClose } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Navigation } from "./navigation";
import { LogoutButton } from "./logout-button";

export function Sidebar() {
  // The dashboard layout keeps this preference while navigating in this session.
  const [expanded, setExpanded] = useState(false);
  const [hint, setHint] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLElement>(null);
  const hintOpen = hint !== null;
  useEffect(() => {
    if (!hintOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setHint(null);
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [hintOpen]);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };
  const hideHint = () => {
    cancelHide();
    setHint(null);
  };
  const showHint = (event: SyntheticEvent<HTMLElement>) => {
    if (expanded || !(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>("[data-tooltip]");
    if (!trigger) return;
    cancelHide();
    const rect = trigger.getBoundingClientRect();
    setHint({
      label: trigger.dataset.tooltip!,
      x: rect.right + 18,
      y: Math.min(
        window.innerHeight - 24,
        Math.max(24, rect.top + rect.height / 2),
      ),
    });
  };
  return (
    <>
      <aside
        ref={panel}
        aria-label="Navegación de escritorio"
        className="orbit-sidebar orbit-nav-panel"
        data-expanded={expanded}
        onMouseOver={showHint}
        onFocus={showHint}
        onMouseLeave={() => {
          cancelHide();
          hideTimer.current = setTimeout(() => setHint(null), 120);
        }}
        onBlur={hideHint}
        onScrollCapture={hideHint}
        onClick={hideHint}
      >
        <div className="orbit-sidebar-header">
          <Logo compact={!expanded} />
          {expanded && (
            <button
              type="button"
              aria-label="Contraer menú"
              className="orbit-sidebar-collapse"
              onClick={() => {
                setExpanded(false);
                requestAnimationFrame(() =>
                  panel.current
                    ?.querySelector<HTMLElement>(
                      '.orbit-nav-row[data-active="true"] .orbit-nav-item',
                    )
                    ?.focus(),
                );
              }}
            >
              <PanelLeftClose aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="orbit-sidebar-scroll">
          <Navigation
            collapsed={!expanded}
            onExpand={() => setExpanded(true)}
          />
        </div>
        <div className="orbit-sidebar-footer">
          <LogoutButton compact={!expanded} />
        </div>
      </aside>
      {hint && !expanded && (
        <div
          role="tooltip"
          className="orbit-sidebar-tooltip"
          style={{ left: hint.x, top: hint.y }}
          onMouseEnter={cancelHide}
          onMouseLeave={hideHint}
        >
          {hint.label}
        </div>
      )}
    </>
  );
}
