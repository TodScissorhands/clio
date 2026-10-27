import ePub from "epubjs";
import type { Book } from "epubjs";

export type EpubBook = Book;

export async function openEpubBook(bytes: Uint8Array): Promise<EpubBook> {
  const book = ePub(Uint8Array.from(bytes).buffer);
  let rejectOpen!: (cause: unknown) => void;
  const openFailure = new Promise<never>((_, reject) => {
    rejectOpen = reject;
  });
  const handleOpenFailure = () => rejectOpen(new Error("The selected file is not a valid EPUB or could not be read."));
  book.on("openFailed", handleOpenFailure);
  try {
    await Promise.race([
      Promise.all([
        book.ready,
        book.loaded.metadata,
        book.loaded.navigation,
        book.loaded.spine,
      ]),
      openFailure,
    ]);
    return book;
  } catch (cause) {
    try {
      book.destroy();
    } catch {
      // Preserve the opening error if cleanup also fails.
    }
    throw cause;
  } finally {
    book.off("openFailed", handleOpenFailure);
  }
}
