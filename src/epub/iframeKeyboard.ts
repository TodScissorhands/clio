import type { Contents, Rendition } from "epubjs";

type Registration = { frame: HTMLIFrameElement; cleanup: () => void };

export function attachEpubKeyboard(
  rendition: Rendition,
  viewport: HTMLElement,
  register: (document: Document) => () => void,
): () => void {
  const registrations = new Map<Document, Registration>();
  let disposed = false;

  const getLiveFrame = (document: Document, contents: Contents[]): HTMLIFrameElement | null => {
    if (!contents.some((content) => content.document === document)) return null;
    const frame = document.defaultView?.frameElement;
    if (!frame || frame.tagName.toLowerCase() !== "iframe" || !viewport.contains(frame)) return null;
    const iframe = frame as HTMLIFrameElement;
    return iframe.contentDocument === document ? iframe : null;
  };
  const removeRegistration = (document: Document, registration: Registration) => {
    registrations.delete(document);
    registration.frame.removeEventListener("load", onFrameLoad);
    registration.cleanup();
  };
  const registerDocument = (document: Document, contents: Contents[]) => {
    if (disposed) return;
    const frame = getLiveFrame(document, contents);
    if (!frame) return;
    const previous = registrations.get(document);
    if (previous?.frame === frame) return;
    if (previous) removeRegistration(document, previous);
    document.documentElement.style.overflowAnchor = "none";
    if (document.body) document.body.style.overflowAnchor = "none";
    registrations.set(document, { frame, cleanup: register(document) });
    frame.addEventListener("load", onFrameLoad);
  };
  const onContent = () => {
    if (disposed) return;
    // epub.js returns an array, despite its bundled getContents() declaration.
    const contents = rendition.getContents() as unknown as Contents[];
    for (const [document, registration] of registrations) {
      if (getLiveFrame(document, contents) !== registration.frame) {
        removeRegistration(document, registration);
      }
    }
    for (const content of contents) registerDocument(content.document, contents);
  };

  const observer = new MutationObserver(onContent);
  observer.observe(viewport, { childList: true, subtree: true });
  // Reconcile after epub.js's iframe.onload has updated the owning Contents.
  const onFrameLoad = () => queueMicrotask(onContent);
  rendition.hooks.content.register(onContent);
  onContent();

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    rendition.hooks.content.deregister(onContent);
    for (const [document, registration] of registrations) {
      removeRegistration(document, registration);
    }
  };
}
