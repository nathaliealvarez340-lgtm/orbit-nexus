"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

// A single cookie control moves into the native dialog's top layer. Increasing
// z-index alone cannot make content outside showModal() interactive.
const PrivacyLayer = createContext<{
  host: HTMLElement | null;
  setHost: (host: HTMLElement | null) => void;
} | null>(null);

export function PrivacyLayerProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <PrivacyLayer.Provider value={{ host, setHost }}>
      {children}
    </PrivacyLayer.Provider>
  );
}
export const usePrivacyLayer = () => useContext(PrivacyLayer);
