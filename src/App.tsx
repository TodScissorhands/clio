import { useCallback, useEffect, useRef, useState } from "react";
import PdfReader from "./reader/PdfReader";
import { EpubReader } from "./epub/EpubReader";
import { openEpubBook } from "./epub/engine";
import type { EpubBook } from "./epub/engine";
import type { ReaderFileSource } from "./platform/tauriReaderFiles";
import { isTauriRuntime, pickNativeReaderFile } from "./platform/tauriReaderFiles";
import { preparePdfDocument } from "./pdf/engine";
import type { PdfLoadingTask, PdfReaderOpenRequest } from "./pdf/engine";
import { useDocumentTitle } from "./reader/useDocumentTitle";
import "./App.css";

type EpubSource = Extract<ReaderFileSource, { kind: "epub" }>;
type PendingPdfOwnership = {
  generation: number;
  task: PdfLoadingTask;
  request: PdfReaderOpenRequest | null;
};

function App() {
  const [nightMode, setNightMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [activeEpub, setActiveEpub] = useState<{ book: EpubBook; path: string | null } | null>(null);
  const [pendingPdfSource, setPendingPdfSource] = useState<PdfReaderOpenRequest | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<(() => void) | null>(null);
  const openGenerationRef = useRef(0);
  const [openGeneration, setOpenGeneration] = useState(0);
  const pendingPdfOwnershipRef = useRef<PendingPdfOwnership | null>(null);
  const activeEpubRef = useRef(activeEpub);
  useDocumentTitle(documentName);
  const toggleNightMode = useCallback(() => setNightMode((current) => !current), []);
  const cancelPendingPdf = useCallback(() => {
    const pending = pendingPdfOwnershipRef.current;
    pendingPdfOwnershipRef.current = null;
    if (pending) void pending.task.destroy().catch(() => undefined);
  }, []);
  const beginOpenRequest = useCallback(() => {
    const generation = ++openGenerationRef.current;
    setOpenGeneration(generation);
    cancelPendingPdf();
    setPendingPdfSource(null);
    setOpenError("");
    return generation;
  }, [cancelPendingPdf]);
  useEffect(() => () => {
    openGenerationRef.current += 1;
    cancelPendingPdf();
  }, [cancelPendingPdf]);
  const openEpub = useCallback(async (source: EpubSource, generation: number) => {
    const book = await openEpubBook(source.bytes);
    if (generation !== openGenerationRef.current) {
      book.destroy();
      return;
    }
    setPendingPdfSource(null);
    const epub = { book, path: source.path };
    activeEpubRef.current = epub;
    setActiveEpub(epub);
    setDocumentName(source.name);
  }, []);
  const clearPendingPdfSource = useCallback((request: PdfReaderOpenRequest) => {
    const pending = pendingPdfOwnershipRef.current;
    if (pending?.request === request && pending.task === request.prepared?.task) {
      // PdfReader has synchronously claimed the task; App no longer owns it.
      pendingPdfOwnershipRef.current = null;
    }
    setPendingPdfSource((current) => current === request ? null : current);
  }, []);
  const handlePdfDocumentChange = useCallback((name: string | null) => {
    if (name === null) beginOpenRequest();
    setDocumentName(name);
  }, [beginOpenRequest]);
  const openReaderSource = useCallback(async (
    source: ReaderFileSource,
    generation = beginOpenRequest(),
  ) => {
    if (generation !== openGenerationRef.current) return;
    if (!source.name.trim()) {
      source = { ...source, name: source.kind === "pdf" ? "Untitled PDF" : "Untitled EPUB" };
    }
    if (source.kind === "epub") {
      await openEpub(source, generation);
      return;
    }
    if (!activeEpubRef.current) {
      setPendingPdfSource({ source, prepared: null, generation });
      return;
    }
    let ownership: PendingPdfOwnership | null = null;
    try {
      const prepared = await preparePdfDocument(
        source.bytes,
        () => generation === openGenerationRef.current,
        (task) => {
          ownership = { generation, task, request: null };
          pendingPdfOwnershipRef.current = ownership;
        },
      );
      if (generation !== openGenerationRef.current) return;
      if (!prepared) {
        cancelPendingPdf();
        return;
      }
      const request = { source, prepared, generation };
      const pending = pendingPdfOwnershipRef.current;
      if (pending?.generation !== generation || pending.task !== prepared.task) return;
      pending.request = request;
      setPendingPdfSource(request);
      activeEpubRef.current = null;
      setActiveEpub(null);
    } catch (cause) {
      if (generation !== openGenerationRef.current) return;
      if (pendingPdfOwnershipRef.current === ownership) cancelPendingPdf();
      throw cause;
    }
  }, [beginOpenRequest, cancelPendingPdf, openEpub]);
  const restoreFocus = useCallback((generation: number) => {
    requestAnimationFrame(() => {
      if (generation === openGenerationRef.current) previousFocusRef.current?.();
    });
  }, []);
  const openDocument = useCallback((restoreReaderFocus?: () => void) => {
    const active = document.activeElement;
    const previous = active instanceof HTMLElement ? active : null;
    previousFocusRef.current = restoreReaderFocus ?? (previous ? () => previous.focus() : null);
    const generation = beginOpenRequest();
    if (!isTauriRuntime()) {
      fileInputRef.current?.click();
      return;
    }
    void (async () => {
      try {
        const source = await pickNativeReaderFile();
        if (source && generation === openGenerationRef.current) await openReaderSource(source, generation);
      } catch (cause) {
        if (generation === openGenerationRef.current) {
          setOpenError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        restoreFocus(generation);
      }
    })();
  }, [beginOpenRequest, openReaderSource, restoreFocus]);

  return (
    <main className="clio-app" data-night-mode={nightMode ? "true" : "false"}>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf,application/epub+zip,.epub"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          const generation = beginOpenRequest();
          if (!file) {
            restoreFocus(generation);
            return;
          }
          const extension = file.name.split(".").pop()?.toLowerCase();
          if (extension !== "pdf" && extension !== "epub") {
            setOpenError("Choose a PDF or EPUB file.");
            restoreFocus(generation);
            return;
          }
          void file.arrayBuffer()
            .then((buffer) => openReaderSource({
              kind: extension,
              name: file.name,
              path: null,
              bytes: new Uint8Array(buffer),
            }, generation))
            .catch((cause: unknown) => {
              if (generation === openGenerationRef.current) {
                setOpenError(cause instanceof Error ? cause.message : String(cause));
              }
            })
            .finally(() => restoreFocus(generation));
        }}
      />
      {openError && <div className="error-banner" role="alert">
        <span>{openError}</span>
        <button className="text-button" onClick={() => setOpenError("")}>Dismiss</button>
      </div>}
      {activeEpub
        ? <EpubReader book={activeEpub.book} path={activeEpub.path} onClose={() => {
            beginOpenRequest();
            activeEpubRef.current = null;
            setActiveEpub(null);
            setDocumentName(null);
          }} onOpenDocument={openDocument} nightMode={nightMode} onToggleNightMode={toggleNightMode} />
        : <PdfReader
            nightMode={nightMode}
            onToggleNightMode={toggleNightMode}
            onOpenDocument={openDocument}
            initialSource={pendingPdfSource}
            onInitialSourceConsumed={clearPendingPdfSource}
            onDocumentChange={handlePdfDocumentChange}
            openGeneration={openGeneration}
          />}
    </main>
  );
}

export default App;

