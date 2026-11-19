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
