import { invoke, isTauri } from "@tauri-apps/api/core";

export type ReadingPosition = { page: number; offset: number };

export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {
  if (!isTauri()) return null;
  return invoke<ReadingPosition | null>("load_reading_position", { path });
}

export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {
  if (!isTauri()) return;
  await invoke("save_reading_position", { path, page: position.page, offset: position.offset });
}
