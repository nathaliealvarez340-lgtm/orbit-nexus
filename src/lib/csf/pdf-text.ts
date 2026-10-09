import "server-only";
import { getDocumentProxy } from "unpdf";
import type { TextLine } from "./parser";

// Text layer only: no rendering and no font faces (the bundled pdf.js has no eval-based
// font path). Scanned PDFs without a text layer yield no lines and are reported as
// UNREADABLE; manual capture stays available.
export const csfPdfLimits = { maxPages: 10, maxCharacters: 200_000 } as const;

export async function extractPdfLines(
  content: Uint8Array,
): Promise<TextLine[]> {
  const pdf = await getDocumentProxy(new Uint8Array(content), {
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const lines: TextLine[] = [];
    let characters = 0;
    for (
      let number = 1;
      number <= Math.min(pdf.numPages, csfPdfLimits.maxPages);
      number++
    ) {
      const page = await pdf.getPage(number);
      const items = (await page.getTextContent()).items.flatMap((item) =>
        "str" in item && item.str.trim()
          ? [
              {
                x: item.transform[4],
                y: item.transform[5],
                text: item.str.trim(),
              },
            ]
          : [],
      );
      // Group items sharing a baseline (2pt tolerance), top to bottom, left to right.
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      for (const item of items) {
        characters += item.text.length;
        if (characters > csfPdfLimits.maxCharacters) return lines;
        const last = lines.at(-1);
        if (last && last.page === number && Math.abs(last.y - item.y) <= 2)
          last.segments.push({ x: item.x, text: item.text });
        else
          lines.push({
            page: number,
            y: item.y,
            segments: [{ x: item.x, text: item.text }],
          });
      }
      for (const line of lines) line.segments.sort((a, b) => a.x - b.x);
    }
    return lines;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
