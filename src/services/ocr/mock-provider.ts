import type { OcrProvider } from "./types";

export const mockOcrProvider: OcrProvider = {
  name: "openai-vision",
  async analyze(file) {
    return {
      provider: "mock",
      confidence: 0.98,
      fields: { archivo: file.name, empresa: "Costco", total: 4860, fecha: "2026-06-09" },
    };
  },
};

