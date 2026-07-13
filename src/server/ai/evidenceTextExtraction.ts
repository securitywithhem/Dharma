/**
 * src/server/ai/evidenceTextExtraction.ts
 *
 * Phase 7 Part 3 — text extraction for evidence auto-tagging. Extends Part 1's
 * document extractor with OCR for screenshots/images (PRD Phase 7: "auto-tagging
 * ... when uploading screenshots/files"). Uses tesseract.js (already a repo
 * dependency) for images; reuses Part 1's extractText for pdf/txt/md.
 */

import { extractText, UnsupportedDocumentError } from "@/server/ai/textExtraction";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function isImage(mimeType: string, filename: string): boolean {
  return (mimeType || "").toLowerCase().startsWith("image/") || IMAGE_EXTS.has(extOf(filename));
}

/** OCR an image buffer to text via tesseract.js (dynamically imported). */
async function ocrImage(buffer: Buffer): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const { data } = await recognize(buffer, "eng");
  return data?.text ?? "";
}

/**
 * Extract text from an evidence file. Images → OCR; pdf/txt/md → Part 1
 * extractor. Unsupported types return an empty string (auto-tagging is a
 * best-effort enhancement and must never fail the surrounding flow).
 */
export async function extractEvidenceText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  if (isImage(mimeType, filename)) {
    return ocrImage(buffer);
  }
  try {
    return await extractText(buffer, mimeType, filename);
  } catch (err) {
    if (err instanceof UnsupportedDocumentError) return "";
    throw err;
  }
}
