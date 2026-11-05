import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { DOCUMENT_THEMES } from "../../src/reader/appearance";
import { parseHexColor } from "../../src/pdf/recolor";
import "../../src/index.css";

declare global {
  interface Window {
    webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
  }
}
const bridge = (message: object) => window.webkit.messageHandlers.test.postMessage(JSON.stringify(message));
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 12_000;
  while (!predicate()) {
    check(performance.now() < deadline, message);
    await settle();
  }
  await settle();
}
async function key(value: string, init: KeyboardEventInit = {}) {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }));
  document.activeElement!.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...init }));
  await settle();
}
async function resize(width: number, height: number) {
  bridge({ resize: [width, height], scale: devicePixelRatio });
  await until(() => innerWidth === width && innerHeight === height, `viewport did not resize to ${width}x${height}`);
}
async function value(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function openFile(name: string) {
  const bytes = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
  const files = new DataTransfer();
  files.items.add(new File([bytes], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
async function command(query: string) {
  await key(":", { shiftKey: true, code: "Semicolon" });
  await until(() => document.querySelector(".command-filter"), "palette did not open");
  await value(document.querySelector<HTMLInputElement>(".command-filter")!, query);
  check(document.querySelectorAll('[role="option"]').length === 1, `command query must identify one action: ${query}`);
  await key("Enter");
  if (query.startsWith("theme_")) {
    check(document.activeElement === document.querySelector(".command-filter"), "theme selection lost filter focus");
    await key("Escape");
    check(readerFocused(), "theme chooser Escape did not restore reader focus");
  }
}
function page() {
  return Number(document.querySelector(".status-page")!.textContent!.match(/Page (\d+)/)![1]);
}
function readerFocused() {
  return document.activeElement?.getAttribute("aria-label") === "PDF reading area";
}
function statusLayout(input?: HTMLInputElement) {
  const bar = document.querySelector<HTMLElement>(".status-bar")!;
  const bounds = bar.getBoundingClientRect();
  check(bounds.height === 24, "status bar must retain its 24px reading footprint");
  check(bar.scrollWidth <= bar.clientWidth + 1, "status bar has horizontal overflow");
  for (const child of bar.children) {
    const style = getComputedStyle(child);
    if (style.display === "none" || style.position === "absolute") continue;
    const rect = child.getBoundingClientRect();
    check(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, `status child wraps or escapes vertically: ${child.className}`);
    check(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, `status child escapes horizontally: ${child.className}`);
  }
  const info = document.querySelector<HTMLElement>(".status-page")!;
  check(info.getBoundingClientRect().width <= document.querySelector<HTMLElement>(".status-document")!.clientWidth + 1,
    "essential page information was clipped before optional metadata");
  const commands = bar.querySelector<HTMLButtonElement>(".status-commands");
  check(Boolean(commands) === !bar.dataset.overlay, "commands entry competes with an active status input");
  if (commands) {
    const button = commands.getBoundingClientRect();
    check(button.height === 24 && info.getBoundingClientRect().right <= button.left, "commands entry overlaps essential page information");
  }
  if (input) {
    check(document.activeElement === input && !input.disabled, "active status input lost focus or editability");
    const style = getComputedStyle(input);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${style.fontSize} ${style.fontFamily}`;
    check(input.clientWidth >= context.measureText(input.value || "120").width + 4, "status input is too small to edit its current value");
    // Offscreen WebKit has no active native window; verify focus paint in Tauri.
  }
  return { height: bounds.height, width: bounds.width, inputWidth: input?.clientWidth };
}
function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722;
  };
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high! + .05) / (low! + .05);
}
function searchPresentation(foreground?: string) {
  const active = document.querySelector<HTMLElement>(".pdfjs-search-highlight.is-active")!;
  const inactive = document.querySelector<HTMLElement>(".pdfjs-search-highlight:not(.is-active)")!;
  check(active && inactive, "real search did not render active/inactive match rectangles");
  const selected = getComputedStyle(active), ordinary = getComputedStyle(inactive);
  const background = getComputedStyle(document.querySelector(".pdfViewer .page")!).backgroundColor;
  check(selected.outlineStyle === "solid" && ordinary.outlineStyle === "dashed" &&
    parseFloat(selected.outlineWidth) > parseFloat(ordinary.outlineWidth) && parseFloat(ordinary.outlineWidth) > 0,
    `active search match lacks structural distinction: ${selected.outline} / ${ordinary.outline}`);
  const ratio = contrast(selected.outlineColor, background);
  check(ratio >= 3 && contrast(ordinary.outlineColor, background) >= 3, "search match boundaries disappear against the page theme");
  const fill = selected.backgroundColor.match(/[\d.]+/g)!.map(Number);
  check(fill.length === 4 && fill[3]! > 0 && fill[3]! < 1, "search fill is not translucent");
  if (foreground) {
    const composite = (channels: number[]) => `rgb(${channels.map((channel, index) => Math.round(channel * (1 - fill[3]!) + fill[index]! * fill[3]!)).join(", ")})`;
    const ink = parseHexColor(foreground).map((channel) => channel * 255);
    const paper = background.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    check(contrast(composite(ink), composite(paper)) >= 4.5, "match fill degrades controlled stock text contrast");
  }
  return { ratio, active: selected.outline, inactive: ordinary.outline, fill: selected.backgroundColor };
}
function errorPresentation() {
  const banner = document.querySelector<HTMLElement>(".error-banner")!;
  const style = getComputedStyle(banner);
  const channels = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
  check(channels.length === 3 || channels[3] === 1, "error background must be opaque over the retained document");
  const ratio = contrast(style.color, style.backgroundColor);
  check(ratio >= 4.5, `error text contrast is insufficient: ${ratio}`);
  const dismiss = banner.querySelector<HTMLButtonElement>("button")!;
  const rect = dismiss.getBoundingClientRect();
  check(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom < innerHeight - 24,
    "error dismissal is obscured or outside the viewport");
  check(banner.getAttribute("role") === "alert", "application error lost accessible alert feedback");
  return { foreground: style.color, background: style.backgroundColor, ratio };
}
async function dismissError() {
  document.querySelector<HTMLButtonElement>(".error-banner button")!.click();
  await until(() => !document.querySelector(".error-banner"), "Dismiss did not remove the application error");
}
function epubText() {
  return [...document.querySelectorAll<HTMLIFrameElement>(".epub-reader iframe")]
    .map((frame) => frame.contentDocument?.body?.textContent ?? "").join(" ");
}

window.addEventListener("error", (event) => bridge({ passed: false, error: event.message }));
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

async function run() {
  await until(() => document.querySelector(".document-viewport"), "reader did not mount");
  document.querySelector<HTMLElement>(".document-viewport")!.focus();
  await resize(420, 600);
  statusLayout();
  check(document.querySelector(".status-page")!.textContent!.includes("Ctrl+O"), "empty reader lost opening feedback");
  document.querySelector<HTMLButtonElement>(".status-commands")!.click();
  await until(() => document.activeElement?.classList.contains("command-filter"), "closed reader commands entry did not focus the palette");
  await key("Escape"); check(readerFocused(), "closed reader commands Escape did not restore focus");
  await openFile("feedback.pdf");
  await until(() => document.querySelector(".loading-indicator"), "real PDF loading state was not observed");
  for (const dark of [false, true]) {
    if (document.querySelector<HTMLElement>(".clio-app")!.dataset.nightMode !== String(dark)) await key("i");
    for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]]) {
      await resize(width!, height!);
      statusLayout();
      check(document.querySelector(".status-loading")!.textContent!.includes("Opening PDF"), "loading feedback is missing");
    }
  }
  await fetch("/__release-worker");
  await until(() => !document.querySelector(".loading-indicator") && document.querySelector(".pdfViewer .textLayer"), "PDF did not finish opening");
  const cases: object[] = [];
  const errorRatios: object[] = [];
  const searchThemes: object[] = [];
  for (const dark of [false, true]) {
    if (!document.querySelector(".pdfViewer .page")) {
      await openFile("feedback.pdf");
      await until(() => document.querySelector(".pdfViewer .textLayer"), "replacement PDF did not render");
    }
    if (document.querySelector<HTMLElement>(".clio-app")!.dataset.nightMode !== String(dark)) await key("i");
    await command("theme_sepia");
    for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]]) {
      await resize(width!, height!);
      statusLayout();
      await key("f", { ctrlKey: true });
      const search = document.querySelector<HTMLInputElement>('[aria-label="Search document"]')!;
      await value(search, "needle"); await key("Enter");
      await until(() => document.querySelector(".search-status")?.textContent?.includes("/ 2280 matches"), "search match feedback did not finish");
      const searchLayout = statusLayout(search);
      searchPresentation();
      if (width === 420) {
        await key("Escape");
        for (const theme of DOCUMENT_THEMES) {
          await command(`theme_${theme.id.replace(/-/g, "_")}`);
          searchThemes.push({ theme: theme.id, dark, ...searchPresentation(theme.foreground ?? "#000000") });
        }
        await command("recolor_set_lightcolor");
        await value(document.querySelector<HTMLInputElement>('[aria-label="Background hex color"]')!, "#EFE7D8"); await key("Enter");
        searchThemes.push({ theme: "custom", dark, ...searchPresentation() });
        await command("theme_sepia");
        await key("f", { ctrlKey: true });
      }
      const count = document.querySelector<HTMLElement>(".search-status")!;
      check(count.scrollWidth <= count.clientWidth + 1, "search count was sacrificed before optional preset metadata");
      const preset = document.querySelector<HTMLElement>(".status-preset")!;
      check((getComputedStyle(preset).display === "none") === (width! <= 600), "optional preset visibility does not respect input priority");
      await key("Escape"); check(readerFocused(), "closing search did not restore reader focus");
      await key("g");
      const jump = document.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
      const original = page();
      for (const invalid of ["", "0", "121", "99999", "1.5", "oops", "-1", " 2 "]) {
        await value(jump, invalid); await key("Enter");
        check(jump.getAttribute("aria-invalid") === "true", `invalid page was not identified: ${invalid}`);
        const feedback = document.getElementById(jump.getAttribute("aria-describedby")!)!;
        check(feedback.getAttribute("role") === "alert" && /1\D+120/.test(feedback.textContent!), "page rejection lacks accessible valid-range feedback");
        check(page() === original, "invalid explicit input silently navigated to another page");
        statusLayout(jump);
        check(feedback.scrollWidth <= feedback.clientWidth + 1, "page feedback truncates its range in an audited viewport");
      }
      await value(jump, "2");
      check(!jump.hasAttribute("aria-invalid") && !document.querySelector(".status-feedback"), "editing retained stale validation feedback");
      await key("Enter");
      await until(() => page() === 2 && !document.querySelector('[aria-label="Page number"]'), "corrected page did not navigate exactly");
      check(readerFocused(), "successful page jump did not restore reader focus");
      for (const boundary of [120, 1]) {
        await key("g");
        await value(document.querySelector<HTMLInputElement>('[aria-label="Page number"]')!, String(boundary));
        await key("Enter");
        await until(() => page() === boundary && readerFocused(), "inclusive page-range boundary was rejected");
      }
      await key("g");
      const retry = document.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
      check(!retry.hasAttribute("aria-invalid"), "reopening retained stale invalid state");
      await value(retry, "99999"); await key("Enter"); await key("Escape");
      check(readerFocused() && !document.querySelector(".status-feedback"), "Escape did not clear invalid feedback and restore focus");
      await key("g");
      const range = document.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
      check(!range.hasAttribute("aria-invalid") && document.getElementById(range.getAttribute("aria-describedby")!)!.textContent === "1–120",
        "valid range hint was not restored after closure");
      statusLayout(range); await key("Escape");
      await command("recolor_set_lightcolor");
      const color = document.querySelector<HTMLInputElement>('[aria-label="Background hex color"]')!;
      statusLayout(color);
      await value(color, "nothex"); await key("Enter");
      errorRatios.push({ dark, width, ...errorPresentation() });
      check(document.querySelector(".pdfViewer .textLayer")!.textContent!.includes("Feedback PDF"), "color error removed the retained document");
      await dismissError(); await key("Escape");
      const previousPage = page(); await key("J");
      await until(() => page() === previousPage + 1, "reader was not operational after error dismissal");
      // Exercise the accepted 09B1 modal contract after feedback transitions.
      await key(":", { shiftKey: true, code: "Semicolon" });
      const filter = document.querySelector<HTMLInputElement>(".command-filter")!;
      await key("Tab"); await key("Tab", { shiftKey: true });
      check(document.activeElement === filter && filter.getAttribute("role") === "combobox", "09B1 filter focus model regressed");
      check(!!document.querySelector('input[type="file"]')!.closest("[inert]"), "09B1 background containment regressed");
      await key("Escape"); check(readerFocused(), "palette Escape restoration regressed");
      cases.push({ width: innerWidth, height: innerHeight, dark: document.querySelector<HTMLElement>(".clio-app")!.dataset.nightMode === "true", searchLayout });
    }
    await openFile("invalid.pdf");
    await until(() => document.querySelector(".error-banner"), "invalid PDF did not report an error");
    errorPresentation();
    check(document.querySelector(".status-page")!.textContent!.includes("/ 120") && document.querySelector(".pdfViewer .textLayer")!.textContent!.includes("Feedback PDF"),
      "invalid PDF replacement lost the valid document");
    await dismissError();
    await openFile("feedback.epub");
    await until(() => epubText().includes("Feedback EPUB chapter 1"), "valid EPUB did not render");
    await openFile("invalid.epub");
    await until(() => document.querySelector(".error-banner"), "invalid EPUB did not report an error");
    errorPresentation();
    check(epubText().includes("Feedback EPUB chapter 1"), "invalid EPUB replacement lost the retained book");
    await dismissError();
    await command("next_chapter");
    await until(() => epubText().includes("Feedback EPUB chapter 2"), "EPUB navigation was not operational after error dismissal");
    await command("Close document");
    await until(() => document.querySelector(".document-viewport"), "EPUB close did not return to the empty PDF reader");
  }
  bridge({ passed: true, cases, errorRatios, searchThemes });
}
void run().catch((error: unknown) => bridge({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }));
