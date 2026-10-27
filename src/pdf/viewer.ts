import * as pdfjs from "pdfjs-dist";
import type { EventBus, PDFViewer, ScrollMode, SimpleLinkService } from "pdfjs-dist/web/pdf_viewer.mjs";

export type PdfJsViewerModule = {
  EventBus: typeof EventBus;
  PDFViewer: typeof PDFViewer;
  ScrollMode: typeof ScrollMode;
  SimpleLinkService: typeof SimpleLinkService;
};

let viewerModule: Promise<PdfJsViewerModule> | null = null;

export function loadPdfJsViewer(): Promise<PdfJsViewerModule> {
  if (!viewerModule) {
    (globalThis as typeof globalThis & { pdfjsLib?: typeof pdfjs }).pdfjsLib = pdfjs;
    viewerModule = import("pdfjs-dist/web/pdf_viewer.mjs");
  }
  return viewerModule;
}
