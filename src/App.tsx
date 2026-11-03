import { useCallback, useRef, useState } from "react";
import PdfReader from "./reader/PdfReader";
import { EpubReader } from "./epub/EpubReader";
import { openEpubBook } from "./epub/engine";
import type { EpubBook } from "./epub/engine";
import type { ReaderFileSource } from "./platform/tauriReaderFiles";
import { isTauriRuntime, pickNativeReaderFile } from "./platform/tauriReaderFiles";
import "./App.css";

type EpubSource = Extract<ReaderFileSource, { kind: "epub" }>;
type PdfSource = Extract<ReaderFileSource, { kind: "pdf" }>;

function App() {
  const [nightMode, setNightMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [activeEpub, setActiveEpub] = useState<{ book: EpubBook; path: string | null } | null>(null);
  const [pendingPdfSource, setPendingPdfSource] = useState<PdfSource | null>(null);
  const [openError, setOpenError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<(() => void) | null>(null);
  const openGenerationRef = useRef(0);
  const toggleNightMode = useCallback(() => setNightMode((current) => !current), []);
  const openEpub = useCallback(async (source: EpubSource, generation: number) => {
    const book = await openEpubBook(source.bytes);
    if (generation !== openGenerationRef.current) {
      book.destroy();
      return;
    }
    setPendingPdfSource(null);
    setActiveEpub({ book, path: source.path });
  }, []);
  const clearPendingPdfSource = useCallback(() => setPendingPdfSource(null), []);
  const openReaderSource = useCallback(async (source: ReaderFileSource) => {
    const generation = ++openGenerationRef.current;
    setOpenError("");
    if (source.kind === "epub") {
      await openEpub(source, generation);
    } else {
      setPendingPdfSource(source);
      setActiveEpub(null);
    }
  }, [openEpub]);
  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => previousFocusRef.current?.());
  }, []);
  const openDocument = useCallback((restoreReaderFocus?: () => void) => {
    const active = document.activeElement;
    const previous = active instanceof HTMLElement ? active : null;
    previousFocusRef.current = restoreReaderFocus ?? (previous ? () => previous.focus() : null);
    setOpenError("");
    if (!isTauriRuntime()) {
      fileInputRef.current?.click();
      return;
    }
    void (async () => {
      try {
        const source = await pickNativeReaderFile();
        if (source) await openReaderSource(source);
      } catch (cause) {
        setOpenError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        restoreFocus();
      }
    })();
  }, [openReaderSource, restoreFocus]);

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
          if (!file) {
            restoreFocus();
            return;
          }
          const extension = file.name.split(".").pop()?.toLowerCase();
          if (extension !== "pdf" && extension !== "epub") {
            setOpenError("Choose a PDF or EPUB file.");
            restoreFocus();
            return;
          }
          void file.arrayBuffer()
            .then((buffer) => openReaderSource({
              kind: extension,
              name: file.name,
              path: null,
              bytes: new Uint8Array(buffer),
            }))
            .catch((cause: unknown) => {
              setOpenError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(restoreFocus);
        }}
      />
      {openError && <div className="error-banner" role="alert">
        <span>{openError}</span>
        <button className="text-button" onClick={() => setOpenError("")}>Dismiss</button>
      </div>}
      {activeEpub
        ? <EpubReader book={activeEpub.book} path={activeEpub.path} onClose={() => {
            openGenerationRef.current += 1;
            setActiveEpub(null);
          }} onOpenDocument={openDocument} />
        : <PdfReader
            onToggleNightMode={toggleNightMode}
            onOpenDocument={openDocument}
            initialSource={pendingPdfSource}
            onInitialSourceConsumed={clearPendingPdfSource}
          />}
    </main>
  );
}

export default App;

