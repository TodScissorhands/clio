import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../platform/tauriReaderFiles";

export function createDocumentTitleWriter(
  setTitle: (title: string) => Promise<void>,
  onError: (cause: unknown) => void,
): (title: string) => Promise<void> {
  let tail = Promise.resolve();
  let revision = 0;
  return (title) => {
    const requestedRevision = ++revision;
    const write = tail.then(async () => {
      if (requestedRevision !== revision) return;
      try {
        await setTitle(title);
      } catch (cause) {
        onError(cause);
      }
    });
    // Even an error reporter must not prevent subsequent title requests.
    tail = write.catch(() => undefined);
    return tail;
  };
}

const writeNativeTitle = createDocumentTitleWriter(
  (title) => getCurrentWindow().setTitle(title),
  (cause) => console.error("Could not update window title:", cause),
);

export function useDocumentTitle(name: string | null): void {
  useEffect(() => {
    const title = name === null ? "Clio" : `${name} — Clio`;
    document.title = title;
    if (isTauriRuntime()) void writeNativeTitle(title);
  }, [name]);
}
