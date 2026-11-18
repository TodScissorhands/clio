import { makeBook, View } from "foliate-js/view.js";
import type { Book } from "foliate-js/view.js";
import { restrictPublicationBackgrounds, sanitizePublicationDocument, secureFoliateBook } from "./foliateSecurity";
import { loadEpubPreferences } from "./preferences";
import type { EpubPreferences } from "./preferences";
import { epubPreferenceCss } from "./preferenceCss";

const typography = new WeakMap<Document, { body: HTMLElement; proseSize: string; prosePriority: string; properties: { name: string; value: string; priority: string }[] }>();
const requested = new WeakMap<View, EpubPreferences>();
const retainedPreferences = new WeakMap<View, string>();

export function foliatePreferenceRetention(view: View): string {
  return retainedPreferences.get(view) ?? "";
}

export function restoreFoliateTypography(doc: Document): void {
  const original = typography.get(doc);
  if (!original) return;
  if (original.proseSize) doc.documentElement.style.setProperty("--clio-prose-size", original.proseSize, original.prosePriority);
  else doc.documentElement.style.removeProperty("--clio-prose-size");
  for (const { name, value, priority } of original.properties) {
    if (value) original.body.style.setProperty(name, value, priority);
    else original.body.style.removeProperty(name);
  }
}

function applyDocumentTypography(doc: Document, preferences: EpubPreferences): void {
  if (!doc.body || !doc.defaultView || doc.URL === "about:blank") return;
  if (!typography.has(doc)) typography.set(doc, {
    body: doc.body,
    proseSize: doc.documentElement.style.getPropertyValue("--clio-prose-size"),
    prosePriority: doc.documentElement.style.getPropertyPriority("--clio-prose-size"),
    properties: ["font-size", "font-family"].map(name => ({
      name, value: doc.body.style.getPropertyValue(name), priority: doc.body.style.getPropertyPriority(name),
    })),
  });
  // Scale the actual publisher body, not a guessed 16px root. Preserve child
  // formatting rather than rewriting every publication element's CSS.
  restoreFoliateTypography(doc);
  const size = parseFloat(doc.defaultView.getComputedStyle(doc.body).fontSize);
  if (preferences.fontScale) {
    doc.documentElement.style.setProperty("--clio-prose-size", `${size * preferences.fontScale / 100}px`, "important");
    doc.body.style.setProperty("font-size", `${size * preferences.fontScale / 100}px`, "important");
  }
  if (preferences.fontFamily !== "publisher") doc.body.style.setProperty("font-family", preferences.fontFamily === "sans" ? "sans-serif" : "serif", "important");
}

export function applyFoliatePreferences(view: View, preferences: EpubPreferences, mode: "paged" | "continuous") {
  const previous = requested.get(view);
  requested.set(view, preferences);
  const renderer = view.renderer;
  // Foliate's navigation anchor can be later than the visible page's start.
  // Capture before any flow, inline typography or stylesheet changes.
  const changed = previous && (previous.fontScale !== preferences.fontScale || previous.fontFamily !== preferences.fontFamily
    || previous.lineHeight !== preferences.lineHeight || previous.alignment !== preferences.alignment
    || previous.margins !== preferences.margins || previous.columnWidth !== preferences.columnWidth);
  const location = changed ? view.lastLocation : null;
  const target = location && view.resolveCFI(location.cfi);
  const doc = target && renderer.getContents().find(content => content.index === target.index)?.doc;
  const anchor = doc && target ? target.anchor(doc) : undefined;
  anchor?.collapse(true);
  const flow = mode === "continuous" ? "scrolled" : "paginated";
  if (renderer.getAttribute("flow") !== flow) renderer.setAttribute("flow", flow);
  if (view.isFixedLayout || view.book.sections.some(section => section.spineProperties?.includes("rendition:layout-pre-paginated"))) {
    retainedPreferences.set(view, "Fixed-layout publication");
  }
  if (retainedPreferences.has(view)) {
    for (const { doc } of renderer.getContents()) restoreFoliateTypography(doc);
    if (!view.isFixedLayout) renderer.setStyles!("");
    for (const name of ["margin-top", "margin-bottom", "margin-left", "margin-right", "max-inline-size"]) {
      if (renderer.hasAttribute(name)) renderer.removeAttribute(name);
    }
    return;
  }
  for (const { doc } of renderer.getContents()) applyDocumentTypography(doc, preferences);
  const css = epubPreferenceCss(preferences);
  // Install the reading-start anchor before Foliate's deferred expansion runs.
  renderer.setStyles!(css);
  for (const side of ["top", "bottom", "left", "right"]) {
    const name = `margin-${side}`;
    if (preferences.margins === "publisher") {
      if (renderer.hasAttribute(name)) renderer.removeAttribute(name);
    } else {
      const value = String({ compact: 12, comfortable: 36, generous: 64 }[preferences.margins]);
      if (renderer.getAttribute(name) !== value) renderer.setAttribute(name, value);
    }
  }
  if (preferences.columnWidth === "publisher") {
    if (renderer.hasAttribute("max-inline-size")) renderer.removeAttribute("max-inline-size");
  } else {
    const value = String({ narrow: 520, comfortable: 720, wide: 960 }[preferences.columnWidth]);
    if (renderer.getAttribute("max-inline-size") !== value) renderer.setAttribute("max-inline-size", value);
  }
  if (anchor) renderer.render!(anchor);
}

function canonicalDocument(doc: Document): Document {
  const svg = doc.contentType === "image/svg+xml";
  sanitizePublicationDocument(doc, svg ? "image/svg+xml" : doc.contentType);
  return new DOMParser().parseFromString(new XMLSerializer().serializeToString(doc), svg ? "image/svg+xml" : "text/html");
}

function compatibleBodyTrees(original: Document, canonical: Document): boolean {
  const originalChildren = original.documentElement.children;
  const canonicalChildren = canonical.documentElement.children;
  if (originalChildren.length !== canonicalChildren.length) return false;
  for (let index = 0; index < originalChildren.length; index++) {
    if (originalChildren[index].localName !== canonicalChildren[index].localName) return false;
  }
  const left = original.createTreeWalker(original.body ?? original.documentElement, NodeFilter.SHOW_ALL);
  const right = canonical.createTreeWalker(canonical.body ?? canonical.documentElement, NodeFilter.SHOW_ALL);
  let a: Node | null = left.currentNode;
  let b: Node | null = right.currentNode;
  while (a && b) {
    if (a.nodeType !== b.nodeType || a.nodeValue !== b.nodeValue) return false;
    if (a.nodeType === Node.ELEMENT_NODE && ((a as Element).localName !== (b as Element).localName ||
      (a as Element).namespaceURI !== (b as Element).namespaceURI)) return false;
    a = left.nextNode(); b = right.nextNode();
  }
  return a === null && b === null;
}

export type FoliateSession = {
  book: Book;
  view: View;
  root: HTMLElement;
  surface: HTMLDivElement;
  chrome: HTMLDivElement;
  isLegacyCfiCompatible: (cfi: string) => Promise<boolean>;
  dispose: () => void;
};

// Candidate rendering is attached but invisible: Foliate needs actual layout dimensions.
// The old document retains ownership until this complete candidate can be committed.
export async function prepareFoliateSession(file: File, signal?: AbortSignal): Promise<FoliateSession> {
  const book = await makeBook(file);
  const removePolicy = secureFoliateBook(book);
  const view = new View();
  // Search and progress must see the same sanitized HTML tree as srcdoc.
  // Otherwise removed active nodes or HTML parser repairs shift their CFIs.
  const originalDocuments = book.sections.map(section => section.createDocument);
  for (let index = 0; index < book.sections.length; index++) {
    const create = originalDocuments[index];
    book.sections[index].createDocument = async () => canonicalDocument(await create());
  }
  const isLegacyCfiCompatible = async (cfi: string) => {
    const { index, anchor } = view.resolveCFI(cfi);
    if (!Number.isInteger(index) || index < 0 || index >= originalDocuments.length) return false;
    const original = await originalDocuments[index]();
    const target = anchor(original);
    if (!(original.body ?? original.documentElement).contains(target.startContainer)) return false;
    return compatibleBodyTrees(original, canonicalDocument(original.cloneNode(true) as Document));
  };
  view.addEventListener("load", event => {
    const doc = (event as CustomEvent<{ doc: Document }>).detail.doc;
    const preferences = requested.get(view);
    if (doc.defaultView?.getComputedStyle(doc.documentElement).writingMode.startsWith("vertical")) {
      retainedPreferences.set(view, "Vertical writing");
      if (preferences) applyFoliatePreferences(view, preferences, view.renderer.getAttribute("flow") === "scrolled" ? "continuous" : "paged");
    }
    if (preferences && !retainedPreferences.has(view)) applyDocumentTypography(doc, preferences);
    restrictPublicationBackgrounds(doc);
  });
  // Never reparent live publication iframes: WebKit reloads them on DOM moves.
  // Preparation and committed reading share this attached, session-owned shell.
  const staging = document.createElement("main");
  staging.className = "clio-app foliate-reader";
  staging.setAttribute("aria-label", "EPUB reader");
  staging.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column;opacity:0;pointer-events:none";
  staging.inert = true;
  const surface = document.createElement("div");
  surface.className = "foliate-publication";
  surface.tabIndex = -1;
  surface.setAttribute("aria-label", "EPUB reading area");
  surface.setAttribute("aria-busy", "true");
  surface.style.cssText = "flex:1;min-height:0;margin-bottom:24px";
  const chrome = document.createElement("div");
  chrome.style.display = "contents";
  view.style.cssText = "display:block;width:100%;height:100%";
  surface.append(view);
  staging.append(surface, chrome);
  document.body.append(staging);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const { doc } of view.renderer?.getContents() ?? []) restoreFoliateTypography(doc);
    view.clearSearch();
    view.close();
    view.remove();
    staging.remove();
    removePolicy();
    book.destroy();
  };
  try {
    signal?.throwIfAborted();
    await view.open(book);
    signal?.throwIfAborted();
    applyFoliatePreferences(view, loadEpubPreferences(), "paged");
    await view.init({ showTextStart: true });
    signal?.throwIfAborted();
    if (!view.lastLocation?.cfi) throw new Error("Publication has no readable starting location");
    return { book, view, root: staging, surface, chrome, isLegacyCfiCompatible, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
