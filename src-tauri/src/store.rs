use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::config;

/// 历史与生词本共用一个可写库，放在配置文件同目录；与只读词典、单词缓存分离。
fn library_path() -> Result<PathBuf, String> {
    let cfg = config::config_path()?;
    let dir = cfg.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    Ok(dir.join("library.db"))
}

fn cache_path() -> Result<PathBuf, String> {
    let cfg = config::config_path()?;
    let dir = cfg.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    Ok(dir.join("word_cache.db"))
}

fn open_rw(path: &PathBuf) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| format!("打开本地库失败：{e}（{}）", path.display()))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            src TEXT NOT NULL, dst TEXT NOT NULL, dir TEXT, model TEXT, kind TEXT, created_at INTEGER);
         CREATE TABLE IF NOT EXISTS favorites (
            word TEXT PRIMARY KEY, entry TEXT NOT NULL, created_at INTEGER);",
    )
    .map_err(|e| format!("创建本地库表失败：{e}"))
}

const HISTORY_CAP: i64 = 100;

#[tauri::command]
pub fn history_add(src: String, dst: String, dir: String, model: String, kind: String) -> Result<(), String> {
    if src.trim().is_empty() || dst.trim().is_empty() {
        return Ok(());
    }
    let conn = open_rw(&library_path()?)?;
    ensure_schema(&conn)?;
    conn.execute(
        "INSERT INTO history (src, dst, dir, model, kind, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![src, dst, dir, model, kind, now_secs()],
    )
    .map_err(|e| format!("写入历史失败：{e}"))?;
    conn.execute(
        "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?1)",
        rusqlite::params![HISTORY_CAP],
    )
    .map_err(|e| format!("裁剪历史失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn history_list() -> Result<Vec<Value>, String> {
    let path = library_path()?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let conn = open_rw(&path)?;
    ensure_schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT id, src, dst, dir, model, kind, created_at FROM history ORDER BY id DESC LIMIT ?1")
        .map_err(|e| format!("查询历史失败：{e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![HISTORY_CAP], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "src": r.get::<_, String>(1)?,
                "dst": r.get::<_, String>(2)?,
                "dir": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "model": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "kind": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                "created_at": r.get::<_, Option<i64>>(6)?.unwrap_or(0),
            }))
        })
        .map_err(|e| format!("查询历史失败：{e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取历史失败：{e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn history_clear() -> Result<(), String> {
    let path = library_path()?;
    if !path.is_file() {
        return Ok(());
    }
    let conn = open_rw(&path)?;
    ensure_schema(&conn)?;
    conn.execute("DELETE FROM history", []).map_err(|e| format!("清空历史失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn favorite_put(word: String, entry: Value) -> Result<(), String> {
    let key = word.trim().to_lowercase();
    if key.is_empty() {
        return Err("词条为空".into());
    }
    let conn = open_rw(&library_path()?)?;
    ensure_schema(&conn)?;
    let text = serde_json::to_string(&entry).map_err(|e| format!("序列化收藏失败：{e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO favorites (word, entry, created_at) VALUES (?1,?2,?3)",
        rusqlite::params![key, text, now_secs()],
    )
    .map_err(|e| format!("写入收藏失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn favorite_remove(word: String) -> Result<(), String> {
    let key = word.trim().to_lowercase();
    let path = library_path()?;
    if !path.is_file() {
        return Ok(());
    }
    let conn = open_rw(&path)?;
    ensure_schema(&conn)?;
    conn.execute("DELETE FROM favorites WHERE word = ?1", rusqlite::params![key])
        .map_err(|e| format!("取消收藏失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn favorite_list() -> Result<Vec<Value>, String> {
    let path = library_path()?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let conn = open_rw(&path)?;
    ensure_schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT word, entry, created_at FROM favorites ORDER BY created_at DESC, word ASC")
        .map_err(|e| format!("查询收藏失败：{e}"))?;
    let rows = stmt
        .query_map([], |r| {
            let entry_text: String = r.get(1)?;
            let entry: Value = serde_json::from_str(&entry_text).unwrap_or(json!({}));
            Ok(json!({
                "word": r.get::<_, String>(0)?,
                "entry": entry,
                "created_at": r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            }))
        })
        .map_err(|e| format!("查询收藏失败：{e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取收藏失败：{e}"))?);
    }
    Ok(out)
}

/// 导出收藏：csv 供表格软件，anki 为制表符分隔（正面=词头+音标，背面=释义+例句）。
/// 写到配置文件同目录，返回落盘路径供界面提示。
#[tauri::command]
pub fn favorites_export(format: String) -> Result<String, String> {
    let items = favorite_list()?;
    let cfg = config::config_path()?;
    let dir = cfg.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let escape_csv = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
    let escape_tsv = |s: &str| s.replace('\t', " ").replace('\r', " ").replace('\n', "<br>");
    let mut text = String::new();
    let name;
    if format == "anki" {
        name = "生词本-anki.txt";
        for it in &items {
            let e = &it["entry"];
            let word = it["word"].as_str().unwrap_or("");
            let phonetic = e["phonetic"].as_str().unwrap_or("");
            let senses = e["senses"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|s| {
                            let pos = s["pos"].as_str().unwrap_or("");
                            let def = s["def"].as_str().unwrap_or("");
                            if pos.is_empty() { def.to_string() } else { format!("{pos} {def}") }
                        })
                        .collect::<Vec<_>>()
                        .join("；")
                })
                .unwrap_or_default();
            let example = e["example"].as_str().unwrap_or("");
            let front = if phonetic.is_empty() { word.to_string() } else { format!("{word} /{phonetic}/") };
            let back = if example.is_empty() { senses } else { format!("{senses}<br>{example}") };
            text.push_str(&format!("{}\t{}\n", escape_tsv(&front), escape_tsv(&back)));
        }
    } else {
        name = "生词本.csv";
        text.push_str("word,phonetic,senses,example,example_cn\n");
        for it in &items {
            let e = &it["entry"];
            let senses = e["senses"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|s| {
                            let pos = s["pos"].as_str().unwrap_or("");
                            let def = s["def"].as_str().unwrap_or("");
                            if pos.is_empty() { def.to_string() } else { format!("{pos} {def}") }
                        })
                        .collect::<Vec<_>>()
                        .join("；")
                })
                .unwrap_or_default();
            text.push_str(&format!(
                "{},{},{},{},{}\n",
                escape_csv(it["word"].as_str().unwrap_or("")),
                escape_csv(e["phonetic"].as_str().unwrap_or("")),
                escape_csv(&senses),
                escape_csv(e["example"].as_str().unwrap_or("")),
                escape_csv(e["exampleCn"].as_str().unwrap_or("")),
            ));
        }
    }
    let path = dir.join(name);
    std::fs::write(&path, text).map_err(|e| format!("导出失败：{e}"))?;
    Ok(path.display().to_string())
}

/// 单词 AI 缓存的条数与占用字节，供设置页展示。
#[tauri::command]
pub fn cache_stats() -> Value {
    let path = match cache_path() {
        Ok(p) => p,
        Err(_) => return json!({ "count": 0, "bytes": 0 }),
    };
    if !path.is_file() {
        return json!({ "count": 0, "bytes": 0 });
    }
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let count = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
    .and_then(|conn| conn.query_row("SELECT COUNT(*) FROM ai_cache", [], |r| r.get::<_, i64>(0)).ok())
    .unwrap_or(0);
    json!({ "count": count, "bytes": bytes })
}

#[tauri::command]
pub fn cache_clear() -> Result<(), String> {
    let path = cache_path()?;
    if !path.is_file() {
        return Ok(());
    }
    let conn = open_rw(&path)?;
    conn.execute("DELETE FROM ai_cache", []).map_err(|e| format!("清空缓存失败：{e}"))?;
    Ok(())
}