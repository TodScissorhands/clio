// Publications are data. This policy must precede every publisher-controlled node.
export const PUBLICATION_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; media-src 'none'";

const forbidden: Record<string, true | undefined> = {
  script: true, base: true, meta: true, iframe: true, frame: true, frameset: true,
  object: true, embed: true, portal: true, applet: true, foreignobject: true,
  animate: true, animatemotion: true, animatetransform: true, set: true, discard: true,
  template: true, "annotation-xml": true,
};
const resourceAttributes: Record<string, true | undefined> = { src: true, poster: true, background: true, href: true };

export function sanitizePublication(source: string, type: string): string {
  const doc = new DOMParser().parseFromString(source, type === "text/html" ? "text/html" : type === "image/svg+xml" ? "image/svg+xml" : "application/xhtml+xml");
  sanitizePublicationDocument(doc, type);
  return new XMLSerializer().serializeToString(doc);
}

export function sanitizePublicationDocument(doc: Document, type: string): void {
  const svg = type === "image/svg+xml";
  if (doc.querySelector("parsererror") || !doc.documentElement) throw new Error("Invalid publication document");
  // Processing instructions can load stylesheets outside the archive.
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_PROCESSING_INSTRUCTION);
  const instructions: Node[] = [];
  while (walker.nextNode()) instructions.push(walker.currentNode);
  for (const node of instructions) node.parentNode?.removeChild(node);
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    const viewport = !svg && tag === "meta" && el.getAttribute("name")?.toLowerCase() === "viewport" && !el.hasAttribute("http-equiv");
    if (forbidden[tag] && !viewport) { el.remove(); continue; }
    // SVG has no HTML CSP meta mechanism. Retain geometry/presentation, not CSS loaders.
    if (svg && (tag === "style" || tag === "link")) { el.remove(); continue; }
    if (tag === "link" && el.getAttribute("rel")?.toLowerCase() !== "stylesheet") { el.remove(); continue; }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.localName.toLowerCase();
      const value = attr.value.trim();
      const anchor = tag === "a" && name === "href";
      if (name.startsWith("on") || ["base", "srcdoc", "srcset", "action", "formaction", "target", "download", "ping", "autofocus", "http-equiv"].includes(name)
        || (svg && (name === "style" || (value.includes("(") && name !== "transform")))
        || (anchor && (/^[\s\u0000-\u0020]*[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || /[\u0000-\u001f]/.test(value)))
        || (!anchor && resourceAttributes[name] && !/^(blob:|data:image\/(?:png|jpeg|gif|webp|avif);)/i.test(value) && !value.startsWith("#"))) {
        el.removeAttributeNode(attr);
      }
    }
  }
  if (!svg) {
    const ns = "http://www.w3.org/1999/xhtml";
    let head = doc.querySelector("head");
    if (!head) { head = doc.createElementNS(ns, "head"); doc.documentElement.prepend(head); }
    const policy = doc.createElementNS(ns, "meta");
    policy.setAttribute("http-equiv", "Content-Security-Policy");
    policy.setAttribute("content", PUBLICATION_CSP);
    head.prepend(policy);
  }
}

// Foliate copies the publication background into its trusted host. An iframe
// CSP cannot constrain that host-side Image/CSS loader.
export function restrictPublicationBackgrounds(doc: Document): void {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element || !doc.defaultView) continue;
    const image = doc.defaultView.getComputedStyle(element).backgroundImage;
    const localImage = /^url\(["']?(?:blob:[^"'()\s]+|data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+)["']?\)$/i.test(image);
    const inertImage = image === "none" || (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(image) && !/(?:url|image|paint|element|cross-fade)\s*\(/i.test(image));
    if (!localImage && !inertImage) element.style.setProperty("background-image", "none", "important");
  }
}

type ResourceEvent = Event & { detail: { data: unknown; href: string; type: string; isScript?: boolean; allow?: boolean } };
export function secureFoliateBook(book: { transformTarget: EventTarget; sections?: { id: string }[] }): () => void {
  const sections = new Set(book.sections?.map(section => section.id));
  const load = (event: Event) => {
    const detail = (event as ResourceEvent).detail;
    if (sections.has(detail.href) && !["application/xhtml+xml", "text/html", "image/svg+xml"].includes(detail.type)) detail.allow = false;
    if (detail.isScript || !/^(?:application\/xhtml\+xml|text\/(?:html|css)|image\/(?:svg\+xml|png|jpeg|gif|webp|avif|bmp|tiff)|font\/(?:otf|ttf|woff2?)|application\/(?:font-woff|vnd\.ms-opentype|x-font-(?:truetype|opentype)))$/i.test(detail.type)) detail.allow = false;
  };
  const data = (event: Event) => {
    const detail = (event as ResourceEvent).detail;
    if (["application/xhtml+xml", "text/html", "image/svg+xml"].includes(detail.type)) {
      detail.data = Promise.resolve(detail.data).then(async value => sanitizePublication(
        value instanceof Blob ? await value.text() : String(value), detail.type));
    }
  };
  book.transformTarget.addEventListener("load", load);
  book.transformTarget.addEventListener("data", data);
  return () => {
    book.transformTarget.removeEventListener("load", load);
    book.transformTarget.removeEventListener("data", data);
  };
}
