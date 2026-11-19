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
  geometry: PdfPageGeometry;
};
export type PdfReaderOpenRequest = {
  generation: number;
  source: Extract<ReaderFileSource, { kind: "pdf" }>;
  prepared: PreparedPdfDocument | null;
};

export function createPdfLoadingTask(data: Uint8Array): PdfLoadingTask {
  return pdfjs.getDocument({ data });
}

export class PdfPageGeometry {
  readonly sizes: (PdfPageSize | undefined)[];
  private readonly inFlight = new Map<number, Promise<PdfPageSize>>();
  private cancelled = false;

  constructor(private readonly pdf: PdfDocument) {
    this.sizes = Array.from({ length: pdf.numPages }, () => undefined);
  }

  async ensure(pageNumbers: readonly number[], isCurrent: () => boolean): Promise<boolean> {
    if (!this.isActive(isCurrent)) return false;
    const requests: Promise<PdfPageSize>[] = [];
    for (const pageNumber of pageNumbers) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.pdf.numPages) {
        throw new RangeError(`Invalid PDF page number: ${pageNumber}`);
      }
      const known = this.sizes[pageNumber - 1];
      if (known) continue;
      let request = this.inFlight.get(pageNumber);
      if (!request) {
        request = this.loadPage(pageNumber);
        this.inFlight.set(pageNumber, request);
        void request.finally(() => {
          if (this.inFlight.get(pageNumber) === request) this.inFlight.delete(pageNumber);
        }).catch(() => {});
      }
      requests.push(request);
    }
    await Promise.all(requests);
    return this.isActive(isCurrent) && pageNumbers.every((pageNumber) => this.sizes[pageNumber - 1] !== undefined);
  }

  async discoverRemaining(isCurrent: () => boolean, onPageSize: (pageNumber: number, size: PdfPageSize) => void): Promise<void> {
    for (let pageNumber = 1; pageNumber <= this.pdf.numPages; pageNumber += 1) {
      if (!this.isActive(isCurrent)) return;
      if (this.sizes[pageNumber - 1]) continue;
      try {
        await this.ensure([pageNumber], isCurrent);
      } catch {
        if (!this.isActive(isCurrent)) return;
        continue;
      }
      if (!this.isActive(isCurrent)) return;
      const size = this.sizes[pageNumber - 1];
      if (size) onPageSize(pageNumber, size);
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  private isActive(isCurrent: () => boolean): boolean {
    return !this.cancelled && isCurrent();
  }

  private async loadPage(pageNumber: number): Promise<PdfPageSize> {
    const page = await this.pdf.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const size = { width: viewport.width, height: viewport.height };
      if (!Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) {
        throw new Error(`PDF page ${pageNumber} has invalid dimensions.`);
      }
      if (!this.cancelled) this.sizes[pageNumber - 1] = size;
      return size;
    } finally {
      page.cleanup();
    }
  }
}

export function createPdfPageGeometry(pdf: PdfDocument): PdfPageGeometry {
  return new PdfPageGeometry(pdf);
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
  if (!isCurrent()) return null;
  return { task, pdf, geometry: createPdfPageGeometry(pdf) };
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
