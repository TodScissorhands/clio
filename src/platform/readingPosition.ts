import { invoke, isTauri } from "@tauri-apps/api/core";

export type ReadingPosition = { page: number; offset: number };
export type EpubReadingPosition = { cfi: string; cfiModel?: "foliate-html-v1" };

export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {
  if (!isTauri()) return null;
  return invoke<ReadingPosition | null>("load_reading_position", { path });
}

export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {
  if (!isTauri()) return;
  await invoke("save_reading_position", { path, page: position.page, offset: position.offset });
}

export async function loadEpubReadingPosition(path: string): Promise<EpubReadingPosition | null> {
  if (!isTauri()) return null;
  return invoke<EpubReadingPosition | null>("load_epub_reading_position", { path });
}

export async function saveEpubReadingPosition(path: string, position: EpubReadingPosition): Promise<void> {
  if (!isTauri()) return;
  await invoke("save_epub_reading_position", { path, cfi: position.cfi, cfiModel: position.cfiModel });
}
