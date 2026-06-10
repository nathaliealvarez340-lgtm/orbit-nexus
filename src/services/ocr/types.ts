import type { OcrResult } from "@/types";

export type OcrProviderName = "openai-vision" | "google-vision" | "aws-textract" | "azure-document-intelligence";

export interface OcrProvider {
  name: OcrProviderName;
  analyze(file: File): Promise<OcrResult>;
}

