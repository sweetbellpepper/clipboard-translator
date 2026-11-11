use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("failed to build http client")
    })
}

pub async fn send(req: HttpRequest) -> Result<HttpResponse, String> {
    let method = match req.method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        other => return Err(format!("unsupported method: {other}")),
    };

    let mut builder = client()
        .request(method, &req.url)
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(10_000).clamp(1000, 120_000)));

    for (name, value) in &req.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body })
}

#[tauri::command]
pub async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    send(req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn post_round_trip_returns_full_body() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let mut raw: Vec<u8> = Vec::new();
            let mut header_end = None;

            loop {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = Some(pos + 4);
                    break;
                }
            }
            let end = header_end.expect("request headers incomplete");
            let head = String::from_utf8_lossy(&raw[..end]).to_string();
            let content_length = head
                .lines()
                .find(|line| line.to_ascii_lowercase().starts_with("content-length:"))
                .and_then(|line| line.split(':').nth(1))
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            while raw.len() < end + content_length {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
            }

            let full = String::from_utf8_lossy(&raw).to_string();
            assert!(full.starts_with("POST / HTTP/1.1"), "unexpected request: {full}");
            assert!(full.to_ascii_lowercase().contains("x-probe: ok"), "header missing: {full}");
            assert!(full.ends_with("ping"), "body missing: {full}");

            let body = "{\"Response\":{\"TargetText\":\"ok\"}}";
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(reply.as_bytes()).unwrap();
        });

        let mut headers = HashMap::new();
        headers.insert("x-probe".to_string(), "ok".to_string());
        let out = tauri::async_runtime::block_on(send(HttpRequest {
            method: "POST".into(),
            url: format!("http://{addr}/"),
            headers,
            body: Some("ping".into()),
            timeout_ms: Some(3000),
        }))
        .expect("request failed");

        assert_eq!(out.status, 200);
        assert_eq!(out.body, "{\"Response\":{\"TargetText\":\"ok\"}}");
    }

    #[test]
    fn rejects_unknown_method_without_network() {
        let err = tauri::async_runtime::block_on(send(HttpRequest {
            method: "DELETE".into(),
            url: "http://127.0.0.1/".into(),
            headers: HashMap::new(),
            body: None,
            timeout_ms: None,
        }))
        .unwrap_err();
        assert!(err.contains("unsupported method"), "got: {err}");
    }

    #[test]
    #[ignore = "联网探针：需要本机 config.local.json 已填入有效 API Key"]
    fn live_probe_real_endpoint() {
        let cfg_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("config.local.json");
        let raw = std::fs::read_to_string(&cfg_path).expect("config.local.json missing");
        let cfg: serde_json::Value = serde_json::from_str(&raw).expect("bad config json");
        let engine = &cfg["engines"][0];
        let key = engine["apiKey"].as_str().expect("missing apiKey");
        let base = engine["baseUrl"].as_str().expect("missing baseUrl").trim_end_matches('/');
        let model = engine["model"].as_str().expect("missing model");
        let url = format!("{base}/chat/completions");

        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), format!("Bearer {key}"));
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "Translate into Chinese: hello"}],
            "stream": false,
            "temperature": 0.2,
        })
        .to_string();

        let out = tauri::async_runtime::block_on(send(HttpRequest {
            method: "POST".into(),
            url,
            headers,
            body: Some(body),
            timeout_ms: Some(20000),
        }))
        .expect("live request failed");
        let parsed: serde_json::Value = serde_json::from_str(&out.body).expect("response not json");
        let content = parsed["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");
        println!("LIVE_STATUS={} CONTENT={}", out.status, content);
        println!("LIVE_USAGE={}", parsed["usage"]);
        assert_eq!(out.status, 200);
        assert!(!content.is_empty(), "empty translation");
    }
}
