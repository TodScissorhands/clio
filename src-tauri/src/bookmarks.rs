use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Write, path::Path, sync::{Mutex, atomic::{AtomicU64, Ordering}}};

#[derive(Default)]
pub struct Bookmarks(pub Mutex<HashMap<String, Vec<(usize, Value)>>>);

fn load(path: &Path) -> Result<Value, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(|e| format!("Bookmarks file is malformed; original retained: {e}"))?;
            if value.get("version").and_then(Value::as_u64) != Some(1) || !value.get("documents").is_some_and(Value::is_object) {
                return Err("Unsupported bookmarks store; original retained".into());
            }
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({"version":1,"documents":{}})),
        Err(e) => Err(format!("Bookmarks unavailable: {e}")),
    }
}

fn write(path: &Path, value: &Value) -> Result<Option<String>, String> {
    let parent = path.parent().ok_or("Invalid bookmarks path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let (temporary, mut file) = super::create_position_sibling(path, "tmp", super::PositionWriteStage::TemporaryCandidate, &mut |_, _| Ok(()))?;
    let result = (|| {
        file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        super::replace_position_file(&temporary, path)?;
        // Replacement has committed. Report a durability warning rather than
        // a failed deletion while the complete new store is already visible.
        Ok(super::sync_position_directory(parent).err().map(|e| format!("Bookmarks updated; directory sync failed: {e}")))
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}

pub fn transaction(state: &Bookmarks, path: &Path, document: &str, session: &str, action: &str, cfi: Option<String>, label: Option<String>, ids: Vec<String>) -> Result<Value, String> {
    let mut undo = state.0.lock().map_err(|e| e.to_string())?;
    let mut warning = None;
    let mut store = match load(path) {
        Ok(store) => store,
        Err(error) => {
            // Recovery is only an explicit add. Unsupported versions and I/O
            // failures remain read-only; malformed bytes must survive verbatim.
            let bytes = fs::read(path).map_err(|_| error.clone())?;
            if action != "add" || serde_json::from_slice::<Value>(&bytes).is_ok() { return Err(error); }
            let (backup, mut file) = super::create_position_sibling(path, "corrupt", super::PositionWriteStage::QuarantineCandidate, &mut |_, _| Ok(()))?;
            file.write_all(&bytes).map_err(|e|e.to_string())?;
            file.sync_all().map_err(|e|e.to_string())?;
            drop(file);
            if fs::read(&backup).map_err(|e|e.to_string())? != bytes { return Err("Bookmark backup verification failed; original retained".into()); }
            super::sync_position_directory(path.parent().ok_or("Invalid bookmarks path")?)?;
            warning = Some(format!("Bookmark saved; malformed original preserved at {}", backup.display()));
            json!({"version":1,"documents":{}})
        }
    };
    let documents = store["documents"].as_object_mut().unwrap();
    let records = documents.entry(document).or_insert_with(|| json!([])).as_array_mut().ok_or("Malformed document bookmarks; original retained")?;
    let mut removed = Vec::new();
    let mut changed = false;
    match action {
        "list" => {},
        "add" => {
            let cfi = cfi.ok_or("Missing bookmark location")?;
            if !super::is_valid_epub_cfi(&cfi) { return Err("Invalid bookmark CFI".into()); }
            if !records.iter().any(|r| r["cfi"] == cfi && r["cfiModel"] == "foliate-html-v1") {
                static NEXT: AtomicU64 = AtomicU64::new(1);
                let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
                let id = format!("{time:x}-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
                records.push(json!({"id":id,"cfi":cfi,"cfiModel":"foliate-html-v1","label":label.unwrap_or_else(||"EPUB".into())}));
                changed = true;
            }
        },
        "delete" => {
            for (i, record) in records.iter().enumerate() {
                let key = record.get("id").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(||format!("unavailable:{i}"));
                if ids.contains(&key) { removed.push((i, record.clone())); }
            }
            for (i, _) in removed.iter().rev() { records.remove(*i); }
            changed = !removed.is_empty();
        },
        "undo" => {
            if let Some(deleted) = undo.get(session) {
                for (i, record) in deleted {
                    if records.iter().any(|r| r.get("id").is_some() && r.get("id") == record.get("id") || r["cfiModel"] == "foliate-html-v1" && record["cfiModel"] == "foliate-html-v1" && r["cfi"] == record["cfi"]) { continue; }
                    records.insert((*i).min(records.len()), record.clone());
                }
                changed = true;
            }
        },
        _ => return Err("Unknown bookmark action".into()),
    }
    let result = records.clone();
    if changed {
        if let Some(sync_warning) = write(path, &store)? {
            warning = Some(match warning { Some(previous) => format!("{previous}. {sync_warning}"), None => sync_warning });
        }
        if action == "delete" { undo.insert(session.into(), removed); }
        if action == "undo" { undo.remove(session); }
    }
    Ok(json!({"records":result,"changed":changed,"canUndo":undo.contains_key(session),"warning":warning}))
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn multiple_dedup_delete_undo_and_preserve_unknown() {
  let dir=std::env::temp_dir().join(format!("clio-marks-{}",std::process::id()));fs::create_dir_all(&dir).unwrap();let p=dir.join("bookmarks.json");let _=fs::remove_file(&p);
  let state=Bookmarks::default();
  let run=|doc:&str,action:&str,cfi:Option<&str>,ids:Vec<String>|transaction(&state,&p,doc,"s",action,cfi.map(str::to_owned),Some("Chapter".into()),ids).unwrap();
  let a=run("a","add",Some("epubcfi(/6/2!/4/1:0)"),vec![]);
  assert_eq!(run("a","add",Some("epubcfi(/6/2!/4/1:0)"),vec![])["changed"],false);
  run("a","add",Some("epubcfi(/6/4!/4/1:0)"),vec![]);
  assert_eq!(run("b","list",None,vec![])["records"],json!([]));
  let id=a["records"][0]["id"].as_str().unwrap().to_owned();
  assert_eq!(run("a","delete",None,vec![id])["records"].as_array().unwrap().len(),1);
  assert_eq!(run("a","undo",None,vec![])["records"].as_array().unwrap().len(),2);
  let mut raw=load(&p).unwrap();
  raw["documents"]["a"].as_array_mut().unwrap().push(json!({"id":"future","cfiModel":"future","extra":{"keep":true}}));
  fs::write(&p,serde_json::to_vec(&raw).unwrap()).unwrap();
  run("b","add",Some("epubcfi(/6/2)"),vec![]);
  assert_eq!(load(&p).unwrap()["documents"]["a"][2],raw["documents"]["a"][2]);
  // A replacement failure cannot remove the complete original store.
  let before=fs::read(&p).unwrap();
  let bad=dir.join("unavailable");fs::create_dir(&bad).unwrap();
  assert!(write(&bad,&raw).is_err());assert_eq!(fs::read(&p).unwrap(),before);
  fs::write(&p,b"{broken").unwrap();assert!(transaction(&state,&p,"a","s","list",None,None,vec![]).is_err());assert_eq!(fs::read(&p).unwrap(),b"{broken");
  let recovered=run("a","add",Some("epubcfi(/6/2)"),vec![]);
  assert!(recovered["warning"].as_str().unwrap().contains("original preserved"));
  assert!(fs::read_dir(&dir).unwrap().filter_map(Result::ok).any(|entry| entry.file_name().to_string_lossy().contains(".corrupt.") && fs::read(entry.path()).unwrap()==b"{broken"));
  fs::write(&p,b"{\"version\":2,\"documents\":{}}").unwrap();assert!(transaction(&state,&p,"a","s","add",Some("epubcfi(/6/2)".into()),None,vec![]).is_err());
  fs::remove_dir_all(dir).unwrap();
 }
}
