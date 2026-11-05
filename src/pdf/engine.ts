import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { ReaderFileSource } from "../platform/tauriReaderFiles";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfDocument = PDFDocumentProxy;
export type PdfLoadingTask = PDFDocumentLoadingTask;
export type PdfPageSize = { width: number; height: number };
export type PreparedPdfDocument = {
  task: PdfLoadingTask;
  pdf: PdfDocument;
  sizes: PdfPageSize[];
};
export type PdfReaderOpenRequest = {
  generation: number;
  source: Extract<ReaderFileSource, { kind: "pdf" }>;
  prepared: PreparedPdfDocument | null;
};

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

/** The caller owns the task from onTask onward, including obsolete/error paths. */
export async function preparePdfDocument(
  bytes: Uint8Array,
  isCurrent: () => boolean,
  onTask: (task: PdfLoadingTask) => void,
): Promise<PreparedPdfDocument | null> {
  const task = createPdfLoadingTask(bytes);
  onTask(task);
  const pdf = await task.promise;
  const sizes = await getPdfPageSizes(pdf, isCurrent);
  return sizes ? { task, pdf, sizes } : null;
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
