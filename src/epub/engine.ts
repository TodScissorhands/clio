import ePub from "epubjs";
import type { Book } from "epubjs";

export type EpubBook = Book;

/** App owns the candidate until full acquisition succeeds; the reader then owns it. */
export async function openEpubBook(bytes: Uint8Array, signal?: AbortSignal): Promise<EpubBook> {
  signal?.throwIfAborted();
  const book = ePub();
  let retired = false;
  const cancel = () => {
    if (retired) return;
    retired = true;
    book.destroy();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.all([
      book.open(Uint8Array.from(bytes).buffer, "binary"),
      book.opened,
      book.ready,
    ]);
    signal?.throwIfAborted();
    return book;
  } catch (cause) {
    cancel();
    throw cause;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
