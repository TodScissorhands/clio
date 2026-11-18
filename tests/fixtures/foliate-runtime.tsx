import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import ePub from "epubjs";
import App from "../../src/App";
import { applyFoliatePreferences, prepareFoliateSession } from "../../src/epub/foliateSession";
import { DEFAULT_EPUB_PREFERENCES } from "../../src/epub/preferences";
import type { View } from "foliate-js/view.js";
import { FoliateReader } from "../../src/epub/FoliateReader";
import type { FoliateSession } from "../../src/epub/foliateSession";

declare global {
  interface Window {
    __cfiPositions: Map<string, unknown>;
    __cfiWrites: { path: string; position: { cfi: string; cfiModel?: string } }[];
  }
}
import "../../src/index.css";

const cases: string[] = [];
let failureObservation: unknown;
const runtimeErrors: string[] = [];
window.addEventListener("error", event => runtimeErrors.push(event.message));
window.addEventListener("unhandledrejection", event => runtimeErrors.push(String(event.reason)));
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function frame() { const next = Promise.withResolvers<void>(); requestAnimationFrame(() => next.resolve()); await next.promise; }
async function until(predicate: () => unknown, label: string) {
  for (let i = 0; i < 1500; i++) { if (predicate()) return; await frame(); }
  failureObservation = readingObservation();
  throw Error(`Timed out: ${label}`);
}
function currentView() { return document.querySelector<View>('.foliate-publication[aria-busy="false"] > foliate-view'); }
function locationDocument(view = currentView()) {
  if (!view?.lastLocation?.cfi) return;
  const { index } = view.resolveCFI(view.lastLocation.cfi);
  return view.renderer.getContents().find(content => content.index === index)?.doc;
}
function paintedPassage(view: View, cfi: string) {
  const { index, anchor } = view.resolveCFI(cfi);
  const doc = view.renderer.getContents().find(content => content.index === index)?.doc;
  if (!doc) return false;
  const range = anchor(doc).cloneRange();
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const node = range.startContainer.childNodes[range.startOffset] ?? range.startContainer;
    const text = node.nodeType === Node.TEXT_NODE ? node : doc.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    if (!text) return false;
    range.setStart(text, 0);
  }
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? "";
  const next = text.slice(range.startOffset).search(/\S/u);
  if (next < 0) return false;
  const start = range.startOffset + next;
  range.setStart(node, start);
  range.setEnd(node, start + String.fromCodePoint(text.codePointAt(start)!).length);
  const frameRect = doc.defaultView?.frameElement?.getBoundingClientRect();
  if (!frameRect) return false;
  const viewport = view.getBoundingClientRect();
  return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 &&
    frameRect.left + rect.left < viewport.right && frameRect.left + rect.right > viewport.left &&
    frameRect.top + rect.top < viewport.bottom && frameRect.top + rect.bottom > viewport.top);
}
function text(view = currentView()) {
  return view?.lastLocation?.cfi && paintedPassage(view, view.lastLocation.cfi)
    ? locationDocument(view)?.body.textContent ?? "" : "";
}
function readingObservation() {
  return {
    native: isTauri(), errors: runtimeErrors.slice(-8),
    views: [...document.querySelectorAll<View>("foliate-view")].slice(0, 4).map(view => ({
      busy: view.parentElement?.getAttribute("aria-busy"), primary: view.renderer?.primaryIndex,
      viewport: view.getBoundingClientRect().toJSON(), cfi: view.lastLocation?.cfi,
      cfiSection: view.lastLocation?.cfi ? view.resolveCFI(view.lastLocation.cfi).index : null,
      addressedPaint: view.lastLocation?.cfi ? paintedPassage(view, view.lastLocation.cfi) : false,
      contents: view.renderer?.getContents().slice(0, 4).map(({ index, doc }) => ({
        index, title: doc.title, text: doc.body.textContent?.slice(0, 180),
        frame: doc.defaultView?.frameElement?.getBoundingClientRect().toJSON(),
      })),
    })),
  };
}
function button(label: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent?.trim() === label);
  check(found, `Missing button ${label}`); found.click();
}
async function option(label: string) {
  await until(() => Array.from(document.querySelectorAll('[role="option"]')).some(el => el.textContent?.includes(label)), `Palette option ${label}`);
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent?.includes(label))!.click();
  await frame();
}
async function command(label: string) {
  await until(() => document.querySelector('button[aria-label="Open reader commands (:)"]'), "Commands footer control");
  button("Commands :");
  await option(label);
}
async function select(name: string) {
  const bytes = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  check(input, "Missing file picker");
  const transfer = new DataTransfer(); transfer.items.add(new File([bytes], name));
  input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function positionCompatibility() {
  const records = window.__cfiPositions = new Map<string, unknown>();
  const writes: Window["__cfiWrites"] = window.__cfiWrites = [];
  const path = "/canonical/position.epub";
  const other = { cfi: "epubcfi(/6/2!/4/2/1:8)", cfiModel: "future-other", extra: true };
  records.set("/canonical/other.epub", other);
  let session: FoliateSession | undefined;
  let root: Root | undefined;
  const close = async () => {
    root?.unmount(); root = undefined;
    session?.dispose(); session = undefined;
    await frame();
  };
  const show = async (buffer: ArrayBuffer, name: string) => {
    session = await prepareFoliateSession(new File([buffer], name));
    root = createRoot(document.getElementById("root")!);
    root.render(<StrictMode><FoliateReader prepared={session} canonicalPath={path} /></StrictMode>);
    await until(() => session?.surface.getAttribute("aria-busy") === "false", "position reader ready");
    await frame();
    return session.view;
  };
  const preserved = (record: unknown) => {
    check(JSON.stringify(records.get(path)) === JSON.stringify(record) && writes.length === 0, "restore/reflow/close overwrote protected position");
    check(records.get("/canonical/other.epub") === other && records.size === 2, "position identity or other record changed");
  };
  const visible = paintedPassage;
  const compatibility = [];
  try {
    for (const name of ["gutenberg-11.epub", "gutenberg-1342.epub"]) {
      const buffer = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
      const legacy = ePub(buffer);
      await legacy.ready;
      const sectionIndex = legacy.spine.length > 5 ? 5 : 1;
      const section = legacy.spine.get(sectionIndex);
      const chapter = await section.load(legacy.load.bind(legacy));
      const passage = chapter.querySelector("p") ?? chapter.querySelector("h1,h2");
      check(passage, `No legacy CFI passage in ${name}`);
      const range = chapter.ownerDocument.createRange();
      range.selectNodeContents(passage); range.collapse(true);
      const cfi = section.cfiFromRange(range);
      const probe = await prepareFoliateSession(new File([buffer], name));
      const compatible = await probe.isLegacyCfiCompatible(cfi);
      for (const mode of ["paged", "continuous", "paged"] as const) {
        applyFoliatePreferences(probe.view, { ...DEFAULT_EPUB_PREFERENCES, fontScale: 140, lineHeight: 1.85 }, mode);
        await probe.view.goTo(0);
        const destination = await probe.view.goTo(cfi);
        check(destination && destination.index === sectionIndex && destination.anchor, `Legacy CFI chapter mismatch in ${name}/${mode}`);
        const doc = probe.view.renderer.getContents().find(c => c.index === sectionIndex)!.doc;
        const target = destination.anchor(doc) as Range;
        const element = target.startContainer.nodeType === Node.ELEMENT_NODE ? target.startContainer as Element : target.startContainer.parentElement;
        check(element?.closest(passage.localName)?.textContent?.includes(passage.textContent!.trim().slice(0, 30)), `Legacy CFI passage mismatch in ${name}/${mode}`);
      }
      const canonicalDoc = probe.view.renderer.getContents().find(c => c.index === sectionIndex)!.doc;
      const canonicalCfi = probe.view.getCFI(sectionIndex, probe.view.resolveCFI(cfi).anchor(canonicalDoc));
      records.set(path, { cfi }); writes.length = 0;
      // App prepares a fresh candidate using the persisted preferences. Do not
      // mount the layout-probe session with its unrelated 140% reflow in flight.
      probe.dispose();
      const view = await show(buffer, name);
      if (compatible) await until(() => visible(view, cfi), `Compatible legacy passage restoration in ${name}: ${cfi}`);
      else check(document.querySelector(".status-feedback")?.textContent?.includes("Original retained"), `Incompatible legacy position was not explained in ${name}`);
      preserved({ cfi });
      await close(); preserved({ cfi });
      const tagged = { cfi: canonicalCfi, cfiModel: "foliate-html-v1" };
      records.set(path, tagged);
      const current = await show(buffer, name);
      await until(() => visible(current, tagged.cfi), `Tagged Foliate passage restoration in ${name}: ${tagged.cfi}`);
      preserved(tagged); await close(); preserved(tagged);
      compatibility.push({ name, sectionIndex, legacyCompatible: compatible, passageResolved: true, taggedRestored: true, modes: ["paged", "continuous", "paged"] });
      legacy.destroy();
    }
    const buffer = await (await fetch("/__fixtures/acquisition-a.epub")).arrayBuffer();
    const changed = await (await fetch("/__fixtures/active-prefix.epub")).arrayBuffer();
    const valid = "epubcfi(/6/2!/4/4[cfi]/1:0)";
    for (const [label, record, source] of [
      ["compatible-legacy", { cfi: valid }, buffer],
      ["changed-legacy-tree", { cfi: valid }, changed],
      ["unresolved-legacy", { cfi: "epubcfi(/6/2000!/4/2/1:0)" }, buffer],
      ["unresolved-tagged", { cfi: "epubcfi(/6/2!/4/2000/1:0)", cfiModel: "foliate-html-v1" }, buffer],
      ["malformed", { cfi: "not-a-cfi" }, buffer],
      ["wrong-cfi-type", { cfi: 42 }, buffer],
      ["null-model", { cfi: valid, cfiModel: null }, buffer],
      ["future-model", { cfi: valid, cfiModel: "future-v2", extra: ["preserve"] }, buffer],
    ] as const) {
      records.set(path, record); writes.length = 0;
      const view = await show(source, label);
      if (label === "compatible-legacy") check(!document.querySelector(".status-feedback") && visible(view, valid), "compatible synthetic legacy position was rejected");
      else check(document.querySelector(".status-feedback")?.textContent?.includes("Original retained"), `${label} restoration did not fail safely`);
      applyFoliatePreferences(view, { ...DEFAULT_EPUB_PREFERENCES, fontScale: 110 }, "continuous");
      await frame(); await frame();
      preserved(record);
      await close(); preserved(record);
      await show(source, label);
      preserved(record);
      await command("Next chapter");
      await until(() => writes.length > 0, `${label} explicit navigation migration`);
      const migrated = records.get(path) as { cfi: string; cfiModel: string };
      check(migrated.cfiModel === "foliate-html-v1" && writes.every(w => w.path === path) &&
        session!.view.renderer.primaryIndex === 1, `${label} navigation did not establish a valid tagged position`);
      await close();
      const reopened = await show(source, label);
      await until(() => visible(reopened, migrated.cfi), `${label} migrated passage reopening`);
      check(records.get(path) === migrated && records.get("/canonical/other.epub") === other && records.size === 2, `${label} reopen corrupted position records`);
      await close();
      cases.push(`${label}: preserved until explicit navigation; tagged migration reopens`);
    }
    return { passed: true, compatibility, cases };
  } finally { await close(); }
}

async function run() {
  if (new URLSearchParams(location.search).has("positions")) return positionCompatibility();
  const mixed = await prepareFoliateSession(new File([await (await fetch("/__fixtures/mixed-mime.epub")).arrayBuffer()], "mixed.epub"));
  try {
    const doc = mixed.view.renderer.getContents().find(({ index }) => index === mixed.view.renderer.primaryIndex)!.doc;
    check(!doc.querySelector("script,iframe,object,meta[http-equiv=refresh]"), "Mixed-case MIME bypassed publication sanitization");
    check(!document.body.dataset.publicationCanary, "Mixed-case MIME executed publication script");
    check(doc.querySelector("#cfi")?.textContent?.includes("book A section 1"), "Mixed-case MIME lost readable publication content");
  } finally { mixed.dispose(); }
  cases.push("mixed-case MIME with parameters retains publication restrictions");
  let rejectedSpine = false;
  try {
    const invalid = await prepareFoliateSession(new File([await (await fetch("/__fixtures/bad-spine-mime.epub")).arrayBuffer()], "invalid-spine.epub"));
    invalid.dispose();
  } catch { rejectedSpine = true; }
  check(rejectedSpine && !document.body.dataset.publicationCanary, "Non-document spine resource crossed the publication boundary");
  cases.push("non-document spine MIME rejected");
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  await until(() => document.querySelector('input[type="file"]'), "App startup");
  // DOM commit precedes StrictMode's passive-effect replay. Let its cleanup
  // finish before dispatching a user acquisition, as the lifecycle fixture does.
  const startup = new MessageChannel();
  const settled = Promise.withResolvers<void>();
  startup.port1.onmessage = () => { startup.port1.close(); startup.port2.close(); settled.resolve(); };
  startup.port2.postMessage(null);
  await settled.promise; await frame();
  await select("acquisition-a.epub");
  await until(() => text().includes("book A section 1"), "First EPUB render");
  const first = currentView()!;
  check(first.getBoundingClientRect().height > 500, "Reader does not fill the viewport");
  const committedDoc = locationDocument(first)!;
  check(committedDoc.defaultView!.getComputedStyle(committedDoc.documentElement).columnWidth !== "auto", "Committing the publication lost its pagination");
  await select("invalid.epub");
  await until(() => document.querySelector('[role="alert"]'), "Invalid replacement error");
  check(currentView() === first && text().includes("book A section 1"), "Invalid replacement lost the current EPUB");
  cases.push("actual EPUB render; invalid replacement retains current document");
  await select("acquisition-b.epub");
  await until(() => currentView() !== first && text().includes("book B section 1"), "Valid replacement");
  check(!first.isConnected, "Old renderer still attached");
  const second = currentView()!;
  await second.goTo(1);
  await until(() => text().includes("book B section 2"), "Chapter navigation");
  const saved = second.lastLocation!.cfi;
  applyFoliatePreferences(second, { ...DEFAULT_EPUB_PREFERENCES, fontScale: 140, lineHeight: 1.85 }, "continuous");
  await second.goTo(0);
  check(await second.goTo(saved), "CFI restore rejected after preference/layout change");
  await until(() => text().includes("book B section 2"), "Restored CFI passage");
  cases.push("chapter navigation; CFI restoration after layout and font changes");
  applyFoliatePreferences(second, DEFAULT_EPUB_PREFERENCES, "paged");
  await command("Search document");
  await until(() => document.querySelector('input[aria-label="Search query"]'), "Search UI");
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search query"]')!;
  check(document.activeElement === input, "Opening search did not focus its query after palette containment was retired");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Paragraph");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await frame(); button("Find");
  await until(() => document.querySelector('.search-status')?.textContent?.includes("1/24"), "Publication-wide search result count");
  check(document.querySelector('.search-status')!.getAttribute("title")!.includes("Paragraph"), "Search excerpt missing");
  const active = () => second.renderer.shadowRoot?.querySelector<SVGGraphicsElement>(".clio-search-active");
  await until(() => active()?.getBBox().height, "Visible active match highlight");
  const firstMatchX = active()!.getBBox().x;
  const firstMatchY = active()!.getBBox().y;
  button("Next");
  await until(() => document.querySelector('.search-status')?.textContent?.includes("2/24") && active()
    && (active()!.getBBox().x !== firstMatchX || active()!.getBBox().y !== firstMatchY), "Next match passage and active geometry");
  button("Previous");
  await until(() => document.querySelector('.search-status')?.textContent?.includes("1/24"), "Previous match");
  cases.push("full publication search count, excerpt, next/previous passage");
  button("Close search");
  await command("Go to chapter");
  await until(() => Array.from(document.querySelectorAll('[role="option"]')).some(el => el.textContent?.includes("Acquisition B chapter 3")), "TOC entries");
  const target = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent?.includes("Acquisition B chapter 3"))!;
  target.click();
  await until(() => text().includes("book B section 3"), "TOC navigation");
  cases.push("shared command palette and TOC navigation");
  const doc = () => locationDocument(second)!;
  const beforeSize = doc().defaultView!.getComputedStyle(doc().body).fontSize;
  await command("Reading preferences");
  await option("Text size…");
  await option("Text size: Larger");
  await until(() => doc().defaultView!.getComputedStyle(doc().body).fontSize !== beforeSize, "Text size applied");
  check(document.querySelector('[role="combobox"]') === document.activeElement, "Preference choice lost filter focus");
  await option("Back to Reading preferences");
  await option("Font…");
  await option("Font: Sans");
  await until(() => doc().defaultView!.getComputedStyle(doc().body).fontFamily.includes("sans-serif"), "Font applied");
  await option("Back to Reading preferences");
  await option("Line spacing…");
  await option("Line spacing: Relaxed");
  await until(() => {
    const style = doc().defaultView!.getComputedStyle(doc().querySelector("p")!);
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize) > 1.8;
  }, "Line spacing applied");
  await option("Back to Reading preferences");
  await option("Back to commands");
  await option("Document theme");
  await option("Sepia");
  await until(() => doc().defaultView!.getComputedStyle(doc().documentElement).backgroundColor === "rgb(251, 240, 217)", "Document theme applied");
  await option("Back to commands");
  await option("Reading preferences");
  await option("Reset typography and layout to Publisher");
  check(JSON.parse(localStorage.getItem("clio:epub-reading-preferences")!).theme === "sepia", "Typography reset discarded document theme");
  await option("Back to commands");
  document.defaultView!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await until(() => !document.querySelector('[role="combobox"]'), "Escape closes preference overlay");
  check(document.activeElement?.getAttribute("aria-label") === "EPUB reading area", "Escape did not return to host reader");
  cases.push("six-field preferences, font/size/spacing/theme, retained filter focus, reset preserves theme, Escape host focus");
  const compatibility = [];
  const sources = new URLSearchParams(location.search).has("real")
    ? ["gutenberg-11.epub", "gutenberg-1342.epub"] : ["acquisition-a.epub", "acquisition-b.epub"];
  for (const name of sources) {
    const buffer = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
    const legacy = ePub(buffer);
    await legacy.ready;
    const sectionIndex = legacy.spine.length > 5 ? 5 : 1;
    const section = legacy.spine.get(sectionIndex);
    const chapter = await section.load(legacy.load.bind(legacy));
    const passage = chapter.querySelector("p") ?? chapter.querySelector("h1,h2");
    check(passage, `No legacy CFI passage in ${name}`);
    const range = chapter.ownerDocument.createRange();
    range.selectNodeContents(passage); range.collapse(true);
    const cfi = section.cfiFromRange(range);
    const restored = await prepareFoliateSession(new File([buffer], name));
    try {
      const legacyCompatible = await restored.isLegacyCfiCompatible(cfi);
      for (const mode of ["paged", "continuous", "paged"] as const) {
        applyFoliatePreferences(restored.view, { ...DEFAULT_EPUB_PREFERENCES, fontScale: 140, lineHeight: 1.85 }, mode);
        await restored.view.goTo(0);
        const destination = await restored.view.goTo(cfi);
        check(destination && destination.index === sectionIndex && destination.anchor, `Legacy CFI chapter mismatch in ${name}/${mode}`);
        const targetDocument = restored.view.renderer.getContents().find(({ index }) => index === sectionIndex)!.doc;
        const targetRange = destination.anchor(targetDocument) as Range;
        const node = targetRange.startContainer;
        const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
        const restoredPassage = element?.closest(passage.localName);
        check(restoredPassage?.textContent?.includes(passage.textContent!.trim().slice(0, 30)), `Legacy CFI passage mismatch in ${name}/${mode}`);
      }
      compatibility.push({ name, cfi, restored: legacyCompatible, passageResolved: true, fontScale: 140, layouts: ["paged", "continuous", "paged"] });
    } finally { legacy.destroy(); restored.dispose(); }
  }
  cases.push("legacy epub.js CFI passage compatibility: " + JSON.stringify(compatibility));
  const long = await prepareFoliateSession(new File([await (await fetch("/__fixtures/long-reading.epub")).arrayBuffer()], "long.epub"));
  try {
    const doc = long.view.renderer.getContents().find(({ index }) => index === long.view.renderer.primaryIndex)!.doc;
    const publisherStyle = doc.body.style.cssText;
    const rem = doc.getElementById("rem-prose")!;
    const publisherRemSize = parseFloat(doc.defaultView!.getComputedStyle(rem).fontSize);
    check(doc.defaultView!.getComputedStyle(doc.body).fontSize === "20px", "Publisher inline font control was not loaded");
    applyFoliatePreferences(long.view, { ...DEFAULT_EPUB_PREFERENCES, fontScale: 120, fontFamily: "sans", lineHeight: 1.6 }, "paged");
    check(doc.defaultView!.getComputedStyle(doc.body).fontSize === "24px", "Text scale did not enlarge the actual publisher font");
    check(doc.defaultView!.getComputedStyle(doc.body).fontFamily === "sans-serif", "Font choice did not override the body preference");
    check(parseFloat(doc.defaultView!.getComputedStyle(rem).fontSize) > publisherRemSize, "Root-relative prose did not enlarge with text preferences");
    applyFoliatePreferences(long.view, DEFAULT_EPUB_PREFERENCES, "paged");
    check(doc.body.style.cssText === publisherStyle, "Publisher reset changed original inline values or priorities");
    await doc.fonts.ready; await frame(); await frame();
    cases.push("publisher-relative size and exact inline Publisher reset");
    const before = long.view.lastLocation!.cfi;
    await long.view.next();
    check(long.view.renderer.primaryIndex === 0 && long.view.lastLocation!.cfi !== before, "Next page skipped the long chapter instead of advancing its passage");
    await long.view.prev();
    check(long.view.renderer.primaryIndex === 0, "Previous page left the long chapter");
    cases.push("long chapter next/previous pages stay within the section");
  } finally { long.dispose(); }
  const file = new File([await (await fetch('/__fixtures/g1c-foliate.epub')).arrayBuffer()], "g1c.epub");
  const malicious = await prepareFoliateSession(file);
  try {
    const doc = malicious.view.renderer.getContents().find(({ index }) => index === malicious.view.renderer.primaryIndex)!.doc;
    check(doc.querySelector('#cfi')?.textContent?.includes('book A section 1'), "G1C replaced publication content");
    check(!doc.querySelector('script,iframe,object,meta[http-equiv="refresh"]'), "Active content survived sanitization");
    check(!document.body.dataset.publicationCanary, "Publication executed JavaScript");
    const link = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).find(el => el.textContent?.includes('Safe internal'));
    check(link, "Internal fragment link lost"); link.click();
    await until(() => text(malicious.view).includes('section 2') &&
      malicious.view.resolveCFI(malicious.view.lastLocation!.cfi).index === 1, "Internal chapter fragment navigation");
    cases.push("G1C content retained; script and nested document restrictions; internal chapter fragment link");
  } finally { malicious.dispose(); }
  const prefixBytes = await (await fetch("/__fixtures/active-prefix.epub")).arrayBuffer();
  const prefix = await prepareFoliateSession(new File([prefixBytes], "active-prefix.epub"));
  const legacyPrefix = ePub(prefixBytes);
  try {
    await legacyPrefix.ready;
    const section = legacyPrefix.spine.get(0);
    const original = await section.load(legacyPrefix.load.bind(legacyPrefix));
    const range = original.ownerDocument.createRange();
    range.selectNodeContents(original.querySelector("#cfi")!); range.collapse(true);
    const oldCfi = section.cfiFromRange(range);
    check(!await prefix.isLegacyCfiCompatible(oldCfi), "Legacy CFI accepted a structurally changed publication");
    const found = [];
    for await (const result of prefix.view.search({ query: "Paragraph" })) {
      if (typeof result === "object" && "cfi" in result) found.push(result);
      else if (typeof result === "object" && "subitems" in result) found.push(...result.subitems);
    }
    check(found.length === 24, "Canonical publication search lost matches");
    await prefix.view.goTo(found[0].cfi);
    const resolved = prefix.view.resolveCFI(found[0].cfi);
    const doc = prefix.view.renderer.getContents().find(content => content.index === resolved.index)!.doc;
    check(resolved.anchor(doc).toString() === "Paragraph", "Sanitized search CFI points at a different passage");
    check(!document.body.dataset.publicationCanary, "Active prefix executed publication code");
    cases.push("sanitized search CFIs match rendered text; changed legacy structure rejected");
  } finally { legacyPrefix.destroy(); prefix.dispose(); }
  // Exercise shell routing as a unit boundary; native command ACLs are checked
  // separately in the actual Tauri window.
  const runtime = window as unknown as { isTauri?: unknown; __TAURI_INTERNALS__?: unknown };
  const previousRuntime = { isTauri: runtime.isTauri, internals: runtime.__TAURI_INTERNALS__ };
  const retainedView = currentView();
  try {
    runtime.isTauri = true;
    runtime.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      check(command === "begin_epub_acquisition", `Pathless acquisition invoked native command ${command}`);
      return 1;
    } };
    check(isTauri(), "Native routing regression did not enable its runtime condition");
    await select("acquisition-a.epub");
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes("pathless content"), "Native pathless rejection");
    check(currentView() === retainedView && text().includes("book B"), "Pathless native content entered the privileged shell or discarded the current book");
  } finally {
    if (previousRuntime.isTauri === undefined) delete runtime.isTauri;
    else runtime.isTauri = previousRuntime.isTauri;
    if (previousRuntime.internals === undefined) delete runtime.__TAURI_INTERNALS__;
    else runtime.__TAURI_INTERNALS__ = previousRuntime.internals;
  }
  cases.push("pathless native EPUB rejected without privileged fallback; current book retained");
  await command("Close document");
  await until(() => !currentView(), "Close EPUB cleanup");
  cases.push("close removes renderer and search state");
  return { passed: true, cases };
}
// The native fixture runner installs this well-known WebKit message handler.
const bridgeWindow = window as unknown as { webkit: { messageHandlers: { test: { postMessage(value: string): void } } } };
const bridge = (value: object) => bridgeWindow.webkit.messageHandlers.test.postMessage(JSON.stringify(value));
run().then(bridge).catch(error => bridge({ passed: false, error: String(error), stack: error.stack, cases,
  document: document.body.innerText, observation: failureObservation ?? readingObservation() }));
