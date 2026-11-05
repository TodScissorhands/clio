import type { Contents, Rendition } from "epubjs";
import { DOCUMENT_THEMES } from "../reader/appearance";
import type { EpubBook } from "./engine";
import { DEFAULT_EPUB_PREFERENCES, normalizeEpubPreferences } from "./preferences";
import type { EpubPreferences } from "./preferences";

const STYLE_KEY = "clio-reading-preferences";
const STYLE_ID_PREFIX = "epubjs-inserted-css-";
const PROTECTED_CONTENT = "pre,code,kbd,samp,table,svg,math,img,picture,video,audio,canvas,iframe,object,embed,form,input,textarea,select,button";
const PROTECTED_BLOCKS = `${PROTECTED_CONTENT},[epub|type~="verse"],[epub|type~="poem"],[epub|type~="z3998:verse"],[epub|type~="z3998:poem"],[epub|type~="z3998:stanza"],[epub|type~="z3998:linegroup"],.verse,.poetry,.poem,.stanza,.linegroup,.manual-break,.manualbreak,.preformatted,.preserve-whitespace,[data-preserve-whitespace],[style*="white-space" i]`;
// The native absolute-size/inline-face failure permits only this ordinary-p exception.
// No descendant styles are measured, rewritten or normalized.
const PROSE = `p:not(:is(${PROTECTED_BLOCKS})):not(:is(${PROTECTED_BLOCKS}) *):not(:has(br,${PROTECTED_CONTENT}))`;
const COLOR_TEXT = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,span,em,strong,b,i,small,sub,sup,mark,abbr,cite,q,s,u,del,ins";
const COLOR_SURFACES = "pre,code,kbd,samp,table,thead,tbody,tfoot,tr,th,td,caption";

type InlineProperty = { value: string; priority: string };
type DocumentStyles = {
  contents: Contents;
  body: HTMLElement;
  baselineSize: number;
  fontSize: InlineProperty;
  fontFamily: InlineProperty;
  sizeOwned: boolean;
  familyOwned: boolean;
  key: string | null;
  node: HTMLElement | null;
};

function restoreProperty(style: CSSStyleDeclaration, property: string, original: InlineProperty): void {
  if (original.value) style.setProperty(property, original.value, original.priority);
  else style.removeProperty(property);
}

function documentCss(preferences: EpubPreferences, baselineSize: number): string {
  const rules: string[] = [];
  const prose: string[] = [];
  if (preferences.fontScale !== null) {
    rules.push(`:root{--clio-prose-size:${baselineSize * preferences.fontScale / 100}px!important}`);
    prose.push("font-size:var(--clio-prose-size)!important");
  }
  if (preferences.fontFamily !== "publisher") prose.push("font-family:inherit!important");
  if (preferences.lineHeight !== null) prose.push(`line-height:${preferences.lineHeight}!important`);
  if (preferences.alignment !== "publisher") prose.push(`text-align:${preferences.alignment}!important`);
  if (prose.length) rules.push(`${PROSE}{${prose.join(";")}}`);

  const theme = DOCUMENT_THEMES.find((entry) => entry.id === preferences.theme);
  if (theme?.background && theme.foreground) {
    const { background, foreground } = theme;
    rules.push(
      `html,body{background-color:${background}!important;color:${foreground}!important}`,
      `:is(${COLOR_TEXT}):not(svg *):not(math *){color:${foreground}!important;background-color:transparent!important}`,
      `${COLOR_SURFACES}{color:${foreground}!important;background-color:${background}!important}`,
      `a,a:link,a:visited{color:${foreground}!important;text-decoration:underline!important}`,
      `::selection{color:${background}!important;background-color:${foreground}!important}`,
    );
  }
  return rules.length ? `@namespace epub "http://www.idpf.org/2007/ops";\n${rules.join("\n")}` : "";
}

export function createEpubStyles(book: EpubBook, rendition: Rendition): {
  registerDocument(document: Document): () => void;
  apply(preferences: EpubPreferences): void;
  dispose(): void;
} {
  // Pre-render captures are weak; only the existing live-Document registrar owns
  // a strong registration. In particular, this adds no frame inventory/observer.
  const captured = new WeakMap<Document, DocumentStyles>();
  const registered = new Map<Document, DocumentStyles>();
  let preferences = normalizeEpubPreferences(DEFAULT_EPUB_PREFERENCES);
  let sizeOverride = false;
  let familyOverride = false;
  let disposed = false;
  const active = () => !disposed && rendition.book === book;
  // epub.js implements this public method but omits it from its bundled types.
  const themes = rendition.themes as typeof rendition.themes & { removeOverride(name: string): void };
  // epub.js returns an array despite its bundled getContents() declaration.
  const liveContents = () => rendition.getContents() as unknown as Contents[];

  const capture = (contents: Contents): DocumentStyles | null => {
    const document = contents.document;
    const previous = captured.get(document);
    if (previous) {
      previous.contents = contents;
      return previous;
    }
    const body = document.body;
    const window = document.defaultView;
    if (!body || !window) return null;
    const baselineSize = Number.parseFloat(window.getComputedStyle(body).fontSize);
    if (!Number.isFinite(baselineSize) || baselineSize <= 0) {
      throw new Error("Unable to measure the EPUB publisher font size.");
    }
    const record: DocumentStyles = {
      contents, body, baselineSize,
      fontSize: {
        value: body.style.getPropertyValue("font-size"),
        priority: body.style.getPropertyPriority("font-size"),
      },
      fontFamily: {
        value: body.style.getPropertyValue("font-family"),
        priority: body.style.getPropertyPriority("font-family"),
      },
      sizeOwned: false, familyOwned: false, key: null, node: null,
    };
    captured.set(document, record);
    return record;
  };

  const removeLayer = (record: DocumentStyles) => {
    record.node?.remove();
    record.node = null;
    record.key = null;
  };
  const updateLayer = (record: DocumentStyles) => {
    const css = documentCss(preferences, record.baselineSize);
    if (!css) {
      removeLayer(record);
      return;
    }
    const document = record.contents.document;
    if (record.key !== null && document.getElementById(STYLE_ID_PREFIX + record.key) !== record.node) {
      removeLayer(record);
    }
    if (record.key === null) {
      let key = STYLE_KEY;
      let suffix = 0;
      while (document.getElementById(STYLE_ID_PREFIX + key)) key = `${STYLE_KEY}-${++suffix}`;
      record.key = key;
    }
    // The supported API replaces this keyed node synchronously (its declaration
    // incorrectly promises a Promise). Keep its actual identity for removal.
    record.contents.addStylesheetCss(css, record.key);
    const node = document.getElementById(STYLE_ID_PREFIX + record.key);
    if (!node || node.localName !== "style") throw new Error("Unable to install EPUB reading preferences.");
    record.node = node;
  };
  const restoreSize = (record: DocumentStyles) => {
    restoreProperty(record.body.style, "font-size", record.fontSize);
    record.sizeOwned = false;
  };
  const restoreFamily = (record: DocumentStyles) => {
    restoreProperty(record.body.style, "font-family", record.fontFamily);
    record.familyOwned = false;
  };
  const cleanDocument = (record: DocumentStyles) => {
    removeLayer(record);
    if (record.sizeOwned) restoreSize(record);
    if (record.familyOwned) restoreFamily(record);
  };

  // Rendition.afterDisplayed triggers render before Themes.overrides in content.
  // Capture before even the first saved preference can overwrite inline !important.
  const beforeThemes = (view: { contents?: Contents }) => {
    if (!active() || !view.contents) return;
    const record = capture(view.contents);
    if (!record) return;
    record.sizeOwned ||= sizeOverride;
    record.familyOwned ||= familyOverride;
  };
  rendition.hooks.render.register(beforeThemes);

  return {
    registerDocument(document) {
      if (!active() || registered.has(document)) return () => {};
      const contents = liveContents().find((entry) => entry.document === document);
      if (!contents) return () => {};
      const record = capture(contents);
      if (!record) return () => {};
      registered.set(document, record);
      updateLayer(record);
      // A same-frame load can replace Contents without another render/content
      // hook. Its registrar captures the new body first, then replays the APIs.
      if (sizeOverride || familyOverride) {
        record.sizeOwned ||= sizeOverride;
        record.familyOwned ||= familyOverride;
        themes.overrides(contents);
      }
      return () => {
        if (registered.get(document) !== record) return;
        registered.delete(document);
        cleanDocument(record);
      };
    },
    apply(requested) {
      if (!active()) return;
      preferences = normalizeEpubPreferences(requested);
      const records = new Set(registered.values());
      // Themes writes every current Contents, not just registered Documents.
      // Capture all its targets before either API can touch them.
      for (const contents of liveContents()) {
        const record = capture(contents);
        if (record) records.add(record);
      }
      for (const record of registered.values()) updateLayer(record);
      if (preferences.fontScale !== null) {
        sizeOverride = true;
        for (const record of records) record.sizeOwned = true;
        themes.fontSize("var(--clio-prose-size)");
      } else if (sizeOverride) {
        themes.removeOverride("font-size");
        sizeOverride = false;
        for (const record of records) restoreSize(record);
      }
      if (preferences.fontFamily !== "publisher") {
        familyOverride = true;
        for (const record of records) record.familyOwned = true;
        themes.font(preferences.fontFamily === "sans" ? "sans-serif" : "serif");
      } else if (familyOverride) {
        themes.removeOverride("font-family");
        familyOverride = false;
        for (const record of records) restoreFamily(record);
      }
    },
    dispose() {
      if (disposed) return;
      rendition.hooks.render.deregister(beforeThemes);
      const records = new Set(registered.values());
      for (const contents of liveContents()) {
        const record = captured.get(contents.document);
        if (record) records.add(record);
      }
      if (sizeOverride) {
        themes.removeOverride("font-size");
        for (const record of records) restoreSize(record);
      }
      if (familyOverride) {
        themes.removeOverride("font-family");
        for (const record of records) restoreFamily(record);
      }
      for (const record of records) cleanDocument(record);
      registered.clear();
      disposed = true;
    },
  };
}
