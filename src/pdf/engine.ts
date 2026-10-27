import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfDocument = PDFDocumentProxy;
export type PdfLoadingTask = PDFDocumentLoadingTask;
export type PdfPageSize = { width: number; height: number };

export function createPdfLoadingTask(data: Uint8Array): PdfLoadingTask {
  return pdfjs.getDocument({ data });
}

export async function getPdfPageSizes(
  pdf: PdfDocument,
  isCurrent: () => boolean,
): Promise<PdfPageSize[] | null> {
  const sizes: PdfPageSize[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (!isCurrent()) return null;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
    page.cleanup();
  }
  return isCurrent() ? sizes : null;
}

export function pdfErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "PasswordException") {
      return "This PDF requires a password. Password entry is not implemented yet.";
    }
    if (error.name === "InvalidPDFException") {
      return "This file does not appear to be a valid PDF.";
    }
  }

  return error instanceof Error
    ? error.message
    : "An unexpected error occurred while opening the PDF.";
}
