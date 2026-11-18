declare module "foliate-js/view.js" {
  export type TOCItem = { label: string; href: string; subitems?: TOCItem[] };
  export type Book = {
    transformTarget: EventTarget;
    sections: { id: string; linear?: string; spineProperties?: string[]; createDocument: () => Promise<Document> }[];
    toc?: TOCItem[];
    metadata?: { title?: string };
    destroy(): void;
  };
  export type SearchMatch = { cfi: string; excerpt: { pre: string; match: string; post: string } };
  export type SearchIterator = AsyncGenerator<SearchMatch | { subitems: SearchMatch[] } | { progress: number } | "done">;
  export class View extends HTMLElement {
    book: Book;
    isFixedLayout: boolean;
    lastLocation: { cfi: string; fraction?: number; tocItem?: TOCItem } | null;
    renderer: HTMLElement & {
      primaryIndex: number;
      page?: number;
      pages?: number;
      setStyles?(styles: string): void;
      render?(anchor?: Range): void;
      getContents(): { doc: Document; index: number }[];
      scrollBy?(x: number, y: number): void;
    };
    open(book: Book): Promise<void>;
    init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    resolveNavigation(target: string | number): { index: number; anchor?: (doc: Document) => Range | Element | number | null | undefined } | null | undefined;
    goTo(target: string | number): Promise<{ index: number; anchor?: (doc: Document) => Range | Element } | undefined>;
    getCFI(index: number, range?: Range): string;
    resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
    next(distance?: number): Promise<void>;
    prev(distance?: number): Promise<void>;
    search(options: { query: string }): SearchIterator;
    clearSearch(): void;
    addAnnotation(annotation: { value: string }): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    close(): void;
  }
  export function makeBook(file: File): Promise<Book>;
}

declare module "foliate-js/overlayer.js" {
  export class Overlayer {
    static highlight(rects: DOMRect[], options?: { color?: string }): SVGElement;
  }
}

declare module "foliate-js/epubcfi.js" {
  export function compare(a: string, b: string): number;
}
