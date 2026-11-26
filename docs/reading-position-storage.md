# Reading-position storage and recovery

Clio stores PDF page/offset records and EPUB CFI records in `reading-positions.json` in its Tauri app-data directory. Keys remain canonical document paths. EPUB `cfiModel: "foliate-html-v1"`, untagged historical CFIs, and the existing IPC/session authorization contracts are unchanged.

## Malformed-file recovery

Loading malformed whole-file JSON still reports an error. On the next position **save**, Clio protects the complete original bytes in a uniquely created sibling before starting a replacement store:

```
reading-positions.json.corrupt.<unix-millis>.<pid>.<sequence>
```

The native stderr log identifies the exact preserved file:

```
Quarantined malformed reading positions; original preserved at <full path>
```

Find this file beside `reading-positions.json` in the app-data directory (`$XDG_DATA_HOME/com.tod.tauri-app` or `~/.local/share/com.tod.tauri-app` on Linux; consult the installed application's Tauri identifier if customized). Keep the quarantined file, and copy it elsewhere before attempting manual repair. Close Clio before manually editing/restoring the active store. Clio does not automatically merge quarantined records into the new store or delete quarantines.

Clio creates the quarantine exclusively, copies the original byte-for-byte, syncs the copy, and on Unix syncs the parent directory before removing the malformed source. A protection failure fails the save without modifying the source. Failure to remove the source retains both it and the complete quarantine. A later replacement failure can leave no active store, but the protected original remains in quarantine; a subsequent save can create a valid store.

Filesystem read errors do not trigger recovery. Valid JSON objects containing unsupported individual records are not quarantined: future CFI models, historical CFIs, malformed individual values, nulls and unknown schemas are retained as JSON values when other positions are saved. PDF records with unknown fields are likewise retained rather than parsed and stripped. Unsupported records are not interpreted as current reading positions. Saving a position for the same canonical key intentionally replaces that key, as before.

## Transactions and limits

The existing shared mutex serializes the complete read/modify/replace operation for PDF and EPUB. EPUB session authorization remains held through that transaction, preventing a retired reader from overwriting a newer session's position.

Each save creates an exclusive sibling `reading-positions.json.tmp.<pid>.<sequence>`, writes complete JSON, and calls `sync_all()` before replacement. Existing temp/quarantine files are never opened for writing or truncated. Ordinary failures clean up only the current transaction's temp; crash-orphaned temps are left alone and are never treated as the active store.

- Unix: same-directory atomic rename, followed by parent-directory `sync_all()`.
- Windows: same-directory `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`, after syncing and closing the temp. No delete-then-rename fallback. Portable Windows directory-fsync semantics are not claimed.
- A post-replacement directory-sync failure is returned to the caller even though the new complete JSON may already be visible. Clio does not roll back or delete that store.
- A poisoned position mutex is retained until a successful serialized disk transaction; errors and further panics leave it poisoned. Recovery is possible because the lock protects no mutable in-memory position map, and disk transactions retain complete old/new JSON or quarantine protected malformed bytes.

These guarantees cover ordinary operations serialized by this Clio process. They do not add cross-process locking, coordinate external editors, or guarantee hardware/filesystem behavior beyond the platform's flush/replacement APIs. Windows execution requires separate platform validation; Linux tests do not establish Windows crash durability.

## EPUB CFI persistence and restoration

The EPUB footer shows whole-book percentage and the first-visible chapter/section in both layouts. Percentage uses Foliate CFI text progress weighted by linear section sizes; estimated book-wide page totals remain deferred.

Native EPUBs save an EPUB CFI in the same app-data `reading-positions.json` file used for PDFs, keyed by canonical file path. Different paths have independent positions; moving or renaming a file gives it a new identity.

New positions carry `cfiModel: "foliate-html-v1"`. Untagged legacy epub.js CFIs restore only when the publication's original and rendered body structures are compatible. Unresolved, malformed and unknown-model records remain intact through opening, reflow and closing; a valid explicit navigation may establish a new tagged position for that same canonical path. No speculative CFI conversion is performed.

Reopening restores the saved passage in paged mode. Typography/layout changes preserve the first-visible reading location rather than merely replaying a prior requested navigation target. Genuine navigation updates are serialized by the reader's save queue; restoration and reflow notifications alone do not migrate or overwrite records. Browser-selected files have no canonical path and do not persist positions. Abrupt application termination can lose unfinished writes.

## Native filesystem execution

The PDF/EPUB path, byte-read and reading-position commands are asynchronous Tauri handlers. Canonicalization, synchronous filesystem calls, JSON processing and position-lock acquisition run through `tauri::async_runtime::spawn_blocking`, not on the native application thread or async executor. Document bytes still use raw IPC responses; command names and payloads are unchanged.

Position workers own a clone of one managed `Arc<Mutex<()>>`. The lock covers each complete store read or read/modify/temporary-write/rename transaction; no mutex guard crosses an await. The existing `reading-positions.json` format, canonical-path keys, unknown-record preservation and malformed-CFI handling are unchanged. Filesystem/validation errors retain their string errors; worker join failures reject with `Native I/O worker failed: …`.

Await a save before a dependent load or save when ordering matters. Overlapping workers serialize in mutex-acquisition order, not invocation order; the last serialized write for a path wins. EPUB save queues and live-session authorization prevent retired sessions from writing another reader's position. The mutex is process-local, not a cross-process file lock.

Explicit PDF close/replacement now flushes the final position; see [PDF lifecycle](pdf-reading-position-lifecycle.md). OS-window shutdown and forced termination have no guaranteed flush barrier. Native workers remove a filesystem blocking source, but do not establish that historical rendering freezes are fixed.

### Historical H01 verification

Native H01 verification exercised the GTK picker, both reader lifecycles, position restoration, invalid replacement recovery and palette/feedback. A bounded delayed-read comparison confirmed native resize/input and independent IPC could proceed while a filesystem worker waited.

These are historical results within the tested native environment, not universal performance or cross-platform guarantees. They do not establish that PDF.js/Foliate or JavaScript rendering stalls, or the historical intermittent freeze, were fixed.

## EPUB bookmarks

Native EPUB sessions use a separate version-1 `bookmarks.json` store keyed by canonical document path. Records carry Foliate CFIs and labels; unknown/unavailable records are retained. The session-authorized transaction validates the live document, serializes mutations, writes an exclusive synced sibling and replaces the store. A directory-sync failure after replacement is reported as a durability warning. Undo retains the last successful deletion for the active session only.

Malformed JSON remains untouched by listing/deletion; an explicit add can preserve the original bytes in a synced, verified corrupt sibling before creating a replacement. Unsupported store versions and I/O failures remain errors. This is separate from reading-position recovery and does not add PDF bookmarks. See [bookmark controls](reader-controls.md#bookmarks).
