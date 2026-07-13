/**
 * src/server/ai/textExtraction.ts
 *
 * Phase 7 Part 1 — raw text extraction for ingested documents.
 *
 * Supports PDF (via the existing `pdf-parse` dependency), and plain text /
 * Markdown decoded as UTF-8. DOCX is intentionally NOT supported yet: no
 * DOCX parser (`mammoth` etc.) is installed, and adding one is out of scope
 * for this part — unsupported types throw a clear, catchable error so the
 * worker can mark the document FAILED with an actionable message.
 */

/** Thrown for MIME types / extensions we can't extract text from yet. */
export class UnsupportedDocumentError extends Error {
  constructor(hint: string) {
    super(`Unsupported document type for text extraction: ${hint}. Supported: pdf, txt, md.`);
    this.name = "UnsupportedDocumentError";
  }
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

/**
 * Extract UTF-8 text from a document buffer.
 * @param buffer  raw file bytes (from MinIO)
 * @param mimeType the stored MIME type
 * @param filename used as a fallback signal when the MIME type is generic
 */
export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const mime = (mimeType || "").toLowerCase();
  const ext = extOf(filename);

  if (mime.includes("pdf") || ext === "pdf") {
    // pdf-parse v2 exposes a `PDFParse` class (not a default function).
    // Dynamic import keeps its pdfjs dependency out of the module-load path.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text ?? "";
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (
    mime.startsWith("text/") ||
    mime.includes("markdown") ||
    ext === "txt" ||
    ext === "md" ||
    ext === "markdown"
  ) {
    return buffer.toString("utf-8");
  }

  if (mime.includes("word") || mime.includes("officedocument") || ext === "docx" || ext === "doc") {
    throw new UnsupportedDocumentError(`${mime || ext} (DOCX parsing not yet installed)`);
  }

  throw new UnsupportedDocumentError(mime || ext || "unknown");
}
