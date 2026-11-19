import { useCallback, useEffect, useRef, useState } from "react";
import PdfReader from "./reader/PdfReader";
import { FoliateReader } from "./epub/FoliateReader";
import { prepareFoliateSession } from "./epub/foliateSession";
import type { FoliateSession } from "./epub/foliateSession";
import type { ReaderFileSource } from "./platform/tauriReaderFiles";
import { isTauriRuntime, pickNativeReaderFile } from "./platform/tauriReaderFiles";
import { preparePdfDocument } from "./pdf/engine";
import type { PdfLoadingTask, PdfReaderOpenRequest } from "./pdf/engine";
import { useDocumentTitle } from "./reader/useDocumentTitle";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type EpubSource = Extract<ReaderFileSource, { kind: "epub" }>;
type PendingPdfOwnership = {
  generation: number;
  task: PdfLoadingTask;
  request: PdfReaderOpenRequest | null;
};

function App() {
  const [nightMode, setNightMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [activeEpub, setActiveEpub] = useState<{ session: FoliateSession | null; nativeId: string | null; path: string | null; generation: number } | null>(null);
  const [pendingPdfSource, setPendingPdfSource] = useState<PdfReaderOpenRequest | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<(() => void) | null>(null);
  const openGenerationRef = useRef(0);
  const [openGeneration, setOpenGeneration] = useState(0);
  const pendingPdfOwnershipRef = useRef<PendingPdfOwnership | null>(null);
  const pendingEpubAbortRef = useRef<AbortController | null>(null);
  const nativeAcquisitionRef = useRef<Promise<number> | null>(null);
  const activeEpubRef = useRef(activeEpub);
  const pdfPositionFlushRef = useRef<(() => Promise<void>) | null>(null);
  const registerPdfPositionFlush = useCallback((flush: () => Promise<void>) => {
    pdfPositionFlushRef.current = flush;
    return () => {
      if (pdfPositionFlushRef.current === flush) pdfPositionFlushRef.current = null;
    };
  }, []);
  useDocumentTitle(documentName);
  const toggleNightMode = useCallback(() => setNightMode((current) => !current), []);
  const cancelPendingPdf = useCallback(() => {
    const pending = pendingPdfOwnershipRef.current;
    pendingPdfOwnershipRef.current = null;
    if (pending) void pending.task.destroy().catch(() => undefined);
  }, []);
  const cancelPendingEpub = useCallback(() => {
    const pending = pendingEpubAbortRef.current;
    pendingEpubAbortRef.current = null;
    pending?.abort();
  }, []);
  const beginOpenRequest = useCallback(() => {
    const generation = ++openGenerationRef.current;
    setOpenGeneration(generation);
    cancelPendingPdf();
    cancelPendingEpub();
    setPendingPdfSource(null);
    setOpenError("");
    if (isTauriRuntime()) {
      const acquisition = invoke<number>("begin_epub_acquisition");
      nativeAcquisitionRef.current = acquisition;
      void acquisition.catch(cause => {
        if (generation === openGenerationRef.current) setOpenError(String(cause));
      });
    }
    return generation;
  }, [cancelPendingPdf, cancelPendingEpub]);
  useEffect(() => () => {
    openGenerationRef.current += 1;
    cancelPendingPdf();
    cancelPendingEpub();
    activeEpubRef.current?.session?.dispose();
    const nativeId = activeEpubRef.current?.nativeId;
    if (nativeId) void invoke("retire_epub_session", { sessionId: nativeId });
  }, [cancelPendingPdf, cancelPendingEpub]);
  const openEpub = useCallback(async (source: EpubSource, generation: number) => {
    const retire = (epub: typeof activeEpub) => {
      epub?.session?.dispose();
      if (epub?.nativeId) void invoke("retire_epub_session", { sessionId: epub.nativeId });
    };
    const controller = new AbortController();
    pendingEpubAbortRef.current = controller;
    let candidate: typeof activeEpub = null;
    try {
      let epub: NonNullable<typeof activeEpub>;
      if (isTauriRuntime()) {
        if (!source.path) throw new Error("Open EPUB files with Clio's native file picker; pathless content cannot enter the privileged shell.");
        const nativeGeneration = await nativeAcquisitionRef.current;
        if (generation !== openGenerationRef.current) return;
        const id = await invoke<string>("create_epub_session", { canonicalPath: source.path, generation: nativeGeneration });
        epub = { session: null, nativeId: id, path: source.path, generation };
      } else {
        if (!source.bytes) throw new Error("Missing EPUB bytes");
        const session = await prepareFoliateSession(new File([source.bytes.slice().buffer], source.name), controller.signal);
        epub = { session, nativeId: null, path: source.path, generation };
      }
      candidate = epub;
      if (generation !== openGenerationRef.current) { retire(epub); return; }
      await pdfPositionFlushRef.current?.();
      if (generation !== openGenerationRef.current) { retire(epub); return; }
      if (epub.nativeId) await invoke("commit_epub_session", { sessionId: epub.nativeId });
      if (generation !== openGenerationRef.current) { retire(epub); return; }
      setPendingPdfSource(null);
      const previous = activeEpubRef.current;
      activeEpubRef.current = epub;
      setActiveEpub(epub);
      setDocumentName(source.name);
      retire(previous);
    } catch (error) {
      if (candidate && activeEpubRef.current !== candidate) retire(candidate);
      throw error;
    } finally {
      if (pendingEpubAbortRef.current === controller) pendingEpubAbortRef.current = null;
    }
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
      activeEpubRef.current?.session?.dispose();
      const nativeId = activeEpubRef.current?.nativeId;
      if (nativeId) void invoke("retire_epub_session", { sessionId: nativeId });
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
        const id = activeEpubRef.current?.nativeId;
        if (id && generation === openGenerationRef.current) {
          try { await invoke("commit_epub_session", { sessionId: id }); }
          catch (cause) {
            if (activeEpubRef.current?.nativeId === id && generation === openGenerationRef.current) setOpenError(String(cause));
          }
        } else restoreFocus(generation);
      }
    })();
  }, [beginOpenRequest, openReaderSource, restoreFocus]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const subscriptions = [
      listen<string>("epub-session-closed", ({ payload }) => {
        if (activeEpubRef.current?.nativeId !== payload) return;
        beginOpenRequest();
        activeEpubRef.current = null;
        setActiveEpub(null);
        setDocumentName(null);
      }),
      listen("epub-request-open", () => openDocument()),
    ];
    return () => { void Promise.all(subscriptions).then(unlisten => unlisten.forEach(stop => stop())); };
  }, [openDocument]);

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
      {activeEpub?.session
        ? <FoliateReader key={activeEpub.generation} prepared={activeEpub.session} canonicalPath={activeEpub.path} onClose={() => {
            beginOpenRequest();
            activeEpubRef.current?.session?.dispose();
            activeEpubRef.current = null;
            setActiveEpub(null);
            setDocumentName(null);
          }} onOpenDocument={openDocument} nightMode={nightMode} onToggleNightMode={toggleNightMode} />
        : <PdfReader
            key={activeEpub?.nativeId ?? "pdf"}
            nightMode={nightMode}
            onToggleNightMode={toggleNightMode}
            onOpenDocument={openDocument}
            initialSource={pendingPdfSource}
            onInitialSourceConsumed={clearPendingPdfSource}
            onDocumentChange={handlePdfDocumentChange}
            openGeneration={openGeneration}
            onRegisterPositionFlush={registerPdfPositionFlush}
          />}
    </main>
  );
}

export default App;

