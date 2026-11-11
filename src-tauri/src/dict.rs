use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::config;

/// 词典库路径：优先取 config.local.json 的 dictPath（相对路径按配置文件所在目录解析），
/// 未配置时默认为配置文件同目录下的 ecdict.db。词库与软件分离，路径可随时改。
fn dict_path() -> Result<PathBuf, String> {
    let cfg = config::config_path()?;
    let dir = cfg.parent().map(Path::to_path_buf).unwrap_or_default();
    let raw = std::fs::read_to_string(&cfg).unwrap_or_default();
    let parsed: Value = serde_json::from_str(&raw).unwrap_or(json!({}));
    match parsed.get("dictPath").and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => {
            let p = PathBuf::from(s.trim());
            Ok(if p.is_absolute() { p } else { dir.join(p) })
        }
        _ => Ok(dir.join("ecdict.db")),
    }
}

/// AI 兜底结果的缓存库，固定放在配置文件同目录（可写位置），与只读词典分离。
fn cache_path() -> Result<PathBuf, String> {
    let cfg = config::config_path()?;
    let dir = cfg.parent().map(Path::to_path_buf).unwrap_or_default();
    Ok(dir.join("word_cache.db"))
}

fn open_readonly(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("打开词典失败：{e}（{}）", path.display()))
}

fn open_rw(path: &Path) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| format!("打开缓存库失败：{e}（{}）", path.display()))
}

/// stardict 行 → JSON。字段与 ECDICT 原始列一一对应，释义归一化交给前端做。
fn row_to_entry(conn: &Connection, word: &str) -> Result<Option<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, frq, bnc, exchange \
             FROM stardict WHERE word = ?1",
        )
        .map_err(|e| format!("查询词典失败：{e}"))?;
    let mut rows = stmt
        .query(rusqlite::params![word])
        .map_err(|e| format!("查询词典失败：{e}"))?;
    let Some(row) = rows.next().map_err(|e| format!("读取词典结果失败：{e}"))? else {
        return Ok(None);
    };
    let text = |i: usize| -> String { row.get::<_, Option<String>>(i).ok().flatten().unwrap_or_default() };
    let num = |i: usize| -> i64 { row.get::<_, Option<i64>>(i).ok().flatten().unwrap_or(0) };
    Ok(Some(json!({
        "word": text(0),
        "phonetic": text(1),
        "definition": text(2),
        "translation": text(3),
        "pos": text(4),
        "collins": num(5),
        "oxford": num(6),
        "tag": text(7),
        "frq": num(8),
        "bnc": num(9),
        "exchange": text(10),
    })))
}

/// 精确查不到时按变形反查原形（inflections 表由 build_dict 示例一次性生成）。
fn lookup_lemma(conn: &Connection, form: &str) -> Result<Option<String>, String> {
    let mut stmt = match conn.prepare("SELECT lemma FROM inflections WHERE form = ?1") {
        Ok(s) => s,
        Err(_) => return Ok(None), // 表不存在视为未构建，跳过
    };
    let mut rows = stmt
        .query(rusqlite::params![form])
        .map_err(|e| format!("查询变形表失败：{e}"))?;
    match rows.next().map_err(|e| format!("读取变形表失败：{e}"))? {
        Some(row) => Ok(Some(row.get::<_, String>(0).map_err(|e| format!("读取变形表失败：{e}"))?)),
        None => Ok(None),
    }
}

fn cache_get(word: &str) -> Result<Option<Value>, String> {
    let path = cache_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let conn = open_rw(&path)?;
    let mut stmt = match conn.prepare("SELECT entry FROM ai_cache WHERE word = ?1") {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let mut rows = stmt
        .query(rusqlite::params![word])
        .map_err(|e| format!("查询缓存失败：{e}"))?;
    let Some(row) = rows.next().map_err(|e| format!("读取缓存失败：{e}"))? else {
        return Ok(None);
    };
    let text: String = row.get(0).map_err(|e| format!("读取缓存失败：{e}"))?;
    serde_json::from_str(&text).map(Some).map_err(|e| format!("缓存内容损坏：{e}"))
}

/// 查词顺序：词典精确 → 词典小写 → 变形反查原形 → AI 缓存。
/// 返回 {found, source: dict|lemma|cache, lemma?, entry}；词典文件缺失不报错，只查缓存。
#[tauri::command]
pub fn dict_lookup(word: String) -> Result<Value, String> {
    let normalized = word.trim();
    if normalized.is_empty() {
        return Ok(json!({ "found": false }));
    }
    let dict = dict_path()?;
    if dict.is_file() {
        let conn = open_readonly(&dict)?;
        // 词条存在但释义为空的（如部分冷门变形词），视同未命中，继续反查原形
        let has_gloss = |e: &Value| {
            !e.get("translation").and_then(Value::as_str).unwrap_or("").trim().is_empty()
                || !e.get("definition").and_then(Value::as_str).unwrap_or("").trim().is_empty()
        };
        for candidate in [normalized, &normalized.to_lowercase()] {
            if let Some(entry) = row_to_entry(&conn, candidate)? {
                if has_gloss(&entry) {
                    // 词典直接收录的变形词（如 befallen）也反查原形，供界面统一显示原形提示
                    let lower = normalized.to_lowercase();
                    let lemma = lookup_lemma(&conn, &lower)?.filter(|l| l != &lower);
                    return Ok(json!({ "found": true, "source": "dict", "lemma": lemma, "entry": entry }));
                }
                break;
            }
        }
        let lower = normalized.to_lowercase();
        if let Some(lemma) = lookup_lemma(&conn, &lower)? {
            if let Some(entry) = row_to_entry(&conn, &lemma)? {
                if has_gloss(&entry) {
                    return Ok(json!({
                        "found": true, "source": "lemma", "lemma": lemma, "entry": entry
                    }));
                }
            }
        }
    }
    if let Some(entry) = cache_get(&normalized.to_lowercase())? {
        return Ok(json!({ "found": true, "source": "cache", "entry": entry }));
    }
    Ok(json!({ "found": false }))
}

/// 写入 AI 兜底结果缓存；entry 由前端校验通过后原样存 JSON 文本。
#[tauri::command]
pub fn dict_cache_put(word: String, entry: Value, model: String) -> Result<(), String> {
    let key = word.trim().to_lowercase();
    if key.is_empty() {
        return Err("词条为空".into());
    }
    let conn = open_rw(&cache_path()?)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_cache (word TEXT PRIMARY KEY, entry TEXT NOT NULL, model TEXT, created_at INTEGER)",
        [],
    )
    .map_err(|e| format!("创建缓存表失败：{e}"))?;
    let text = serde_json::to_string(&entry).map_err(|e| format!("序列化缓存失败：{e}"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT OR REPLACE INTO ai_cache (word, entry, model, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![key, text, model, now],
    )
    .map_err(|e| format!("写入缓存失败：{e}"))?;
    Ok(())
}

/// 设置页展示词典状态：路径、是否存在、词条量（MAX(id) 瞬时估算）、变形表是否已构建。
#[tauri::command]
pub fn dict_status() -> Value {
    let path = match dict_path() {
        Ok(p) => p,
        Err(e) => return json!({ "exists": false, "error": e }),
    };
    let mut status = json!({ "path": path.display().to_string(), "exists": path.is_file() });
    if !path.is_file() {
        return status;
    }
    match open_readonly(&path) {
        Ok(conn) => {
            let entries: i64 = conn
                .query_row("SELECT MAX(id) FROM stardict", [], |r| r.get(0))
                .unwrap_or(0);
            let inflections: i64 = conn
                .query_row("SELECT COUNT(*) FROM inflections", [], |r| r.get(0))
                .unwrap_or(0);
            status["entries"] = json!(entries);
            status["inflections"] = json!(inflections > 0);
        }
        Err(e) => status["error"] = json!(e),
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_inflections_to_headword() {
        let pairs = parse_exchange("apple", "s:apples/d:0/i:0");
        assert_eq!(pairs, vec![("apples".to_string(), "apple".to_string())]);
    }

    #[test]
    fn maps_headword_to_lemma_zero_field() {
        // 变形词条自身也收录时，exchange 的 0: 指向原形
        let pairs = parse_exchange("better", "0:good/r:0/t:0");
        assert_eq!(pairs, vec![("better".to_string(), "good".to_string())]);
    }

    #[test]
    fn skips_empty_and_placeholder_values() {
        assert!(parse_exchange("x", "").is_empty());
        assert!(parse_exchange("x", "d:0/i:0/p:0").is_empty());
    }
}

/// 解析 ECDICT exchange 字段，生成「变形 → 原形」映射：
/// p/d/i/r/t/s 的值是该词条的变形，映射到词条本身；0 的值是原形，词条本身映射过去。
/// examples/build_dict.rs 构建 inflections 表时复用这份逻辑。
pub fn parse_exchange(headword: &str, exchange: &str) -> Vec<(String, String)> {
    let head = headword.to_lowercase();
    let mut out = Vec::new();
    for part in exchange.split('/') {
        let Some((k, v)) = part.split_once(':') else { continue };
        let v = v.trim().to_lowercase();
        if v.is_empty() || v == "0" || v == head {
            continue;
        }
        match k {
            "0" => out.push((head.clone(), v)),
            "p" | "d" | "i" | "r" | "t" | "s" => out.push((v, head.clone())),
            _ => {}
        }
    }
    out
}
