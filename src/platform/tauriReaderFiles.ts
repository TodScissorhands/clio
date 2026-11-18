import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openNativeDialog } from "@tauri-apps/plugin-dialog";

export type ReaderFileSource =
  | { kind: "pdf"; name: string; bytes: Uint8Array; path: string | null }
  | { kind: "epub"; name: string; bytes: Uint8Array | null; path: string | null };

export function isTauriRuntime(): boolean {
  return isTauri();
}

export async function pickNativeReaderFile(): Promise<ReaderFileSource | null> {
  const selected = await openNativeDialog({
    multiple: false,
    filters: [{ name: "Documents", extensions: ["pdf", "epub"] }],
  });
  if (typeof selected !== "string") return null;

  const extension = selected.split(".").pop()?.toLowerCase();
  if (extension !== "pdf" && extension !== "epub") {
    throw new Error("Choose a PDF or EPUB file.");
  }
  const kind = extension;
  const path = await invoke<string>(`canonicalize_${kind}_path`, { path: selected });
  const name = path.split(/[/\\]/).pop() || path;
  if (kind === "epub") return { kind, name, path, bytes: null };
  const bytes = await invoke<ArrayBuffer>("read_pdf_file", { path });
  return { kind, name, path, bytes: new Uint8Array(bytes) };
}
