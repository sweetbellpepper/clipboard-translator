use std::path::PathBuf;

use serde_json::{json, Value};

const ENGINE_KEYS: &[&str] = &["apiKey", "baseUrl", "model", "displayName"];
const ROOT_KEYS: &[&str] = &["timeoutMs", "maxChars", "dictPath"];

fn candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join("config.local.json"));
        if let Some(parent) = cwd.parent() {
            paths.push(parent.to_path_buf().join("config.local.json"));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            match dir {
                Some(current) => {
                    paths.push(current.join("config.local.json"));
                    dir = current.parent().map(|p| p.to_path_buf());
                }
                None => break,
            }
        }
    }

    let mut unique = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

pub fn config_path() -> Result<PathBuf, String> {
    let paths = candidates();
    let searched = paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(" 或 ");
    paths
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| format!("未找到 config.local.json（已查找：{searched}）"))
}

fn write_path() -> Result<PathBuf, String> {
    let paths = candidates();
    if let Some(existing) = paths.iter().find(|p| p.is_file()) {
        return Ok(existing.clone());
    }
    paths
        .into_iter()
        .next()
        .ok_or_else(|| "无法确定配置文件位置".to_string())
}

fn default_engine() -> Value {
    json!({ "id": "hy", "displayName": "混元翻译" })
}

/// 只把白名单字段合并进现有配置，避免前端传来的任意内容写进文件。
fn merge_settings(root: &mut Value, patch: &Value) -> Result<(), String> {
    let obj = root
        .as_object_mut()
        .ok_or_else(|| "配置根节点必须是对象".to_string())?;
    let patch = patch
        .as_object()
        .ok_or_else(|| "patch 必须是对象".to_string())?;

    for key in ROOT_KEYS {
        if let Some(value) = patch.get(*key) {
            obj.insert((*key).to_string(), value.clone());
        }
    }

    if ENGINE_KEYS.iter().any(|key| patch.contains_key(*key)) {
        if !obj.get("engines").is_some_and(Value::is_array) {
            obj.insert("engines".to_string(), json!([default_engine()]));
        }
        let engines = obj
            .get_mut("engines")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "engines 必须是数组".to_string())?;
        if engines.is_empty() {
            engines.push(default_engine());
        }
        let engine = engines[0]
            .as_object_mut()
            .ok_or_else(|| "engines[0] 必须是对象".to_string())?;
        for key in ENGINE_KEYS {
            if let Some(value) = patch.get(*key) {
                engine.insert((*key).to_string(), value.clone());
            }
        }
        if !engine.contains_key("id") {
            engine.insert("id".to_string(), json!("hy"));
        }
        let id = engine
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("hy")
            .to_string();
        obj.insert("defaultEngineId".to_string(), json!(id));
    }

    Ok(())
}

#[tauri::command]
pub fn read_config() -> Result<String, String> {
    let path = config_path()?;
    std::fs::read_to_string(&path)
        .map_err(|e| format!("读取配置失败：{e}（{}）", path.display()))
}

#[tauri::command]
pub fn config_location() -> Result<String, String> {
    config_path().map(|p| p.display().to_string())
}

#[tauri::command]
pub fn save_settings(patch: Value) -> Result<(), String> {
    let path = write_path()?;
    let mut root: Value = if path.is_file() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取配置失败：{e}"))?;
        serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    merge_settings(&mut root, &patch)?;

    let text = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("序列化配置失败：{e}"))?;
    let tmp = path.with_file_name("config.local.json.tmp");
    std::fs::write(&tmp, &text).map_err(|e| format!("写入配置失败：{e}"))?;
    if std::fs::rename(&tmp, &path).is_err() {
        // 少数 Windows 环境不允许直接覆盖，退化为写目标文件
        std::fs::write(&path, &text).map_err(|e| format!("保存配置失败：{e}"))?;
        let _ = std::fs::remove_file(&tmp);
    }
    // 错误信息里不含密钥值，也不记录 patch 内容
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_config_from_project_root() {
        let path = config_path().expect("config.local.json should be discoverable");
        assert!(path.is_file(), "not a file: {}", path.display());
        let text = std::fs::read_to_string(&path).expect("config should be readable");
        assert!(text.contains("\"engines\""), "config must define engines");
    }

    #[test]
    fn merge_only_updates_whitelisted_fields() {
        let mut root = json!({
            "timeoutMs": 15000,
            "maxChars": 1000,
            "engines": [{ "id": "hy", "displayName": "混元翻译", "apiKey": "old", "baseUrl": "https://a/v1", "model": "hy-mt2-plus" }]
        });
        let patch = json!({
            "apiKey": "new-key",
            "maxChars": 600,
            "dictPath": "ecdict.db",
            "wordModel": "deepseek-v4.1-flash-1017",
            "dictEnabled": false,
            "unexpected": "must be ignored"
        });
        merge_settings(&mut root, &patch).unwrap();
        assert_eq!(root["engines"][0]["apiKey"], "new-key");
        assert_eq!(root["maxChars"], 600);
        assert_eq!(root["dictPath"], "ecdict.db");
        assert_eq!(root["engines"][0]["baseUrl"], "https://a/v1");
        assert!(root.get("unexpected").is_none());
        // 详解开关与单词模型键已移除（单词模型固定 deepseek），白名单不再接受
        assert!(root.get("dictEnabled").is_none());
        assert!(root.get("wordModel").is_none());
    }

    #[test]
    fn merge_creates_engine_when_missing() {
        let mut root = json!({});
        merge_settings(&mut root, &json!({ "apiKey": "k" })).unwrap();
        assert_eq!(root["engines"][0]["apiKey"], "k");
        assert_eq!(root["defaultEngineId"], "hy");
    }
}
