mod config;
pub mod dict;
mod http;
mod store;
mod system;

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, LogicalSize, Manager, Size};

const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 0x0002;

static WATCHING: AtomicBool = AtomicBool::new(true);
static PAUSED: AtomicBool = AtomicBool::new(false);

fn suppress_slot() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

#[link(name = "user32")]
unsafe extern "system" {
    fn GetClipboardSequenceNumber() -> u32;
    fn OpenClipboard(h_wnd_new_owner: *mut c_void) -> i32;
    fn CloseClipboard() -> i32;
    fn GetClipboardData(u_format: u32) -> *mut c_void;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
    fn EmptyClipboard() -> i32;
    fn SetClipboardData(u_format: u32, h_mem: *mut c_void) -> *mut c_void;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalAlloc(u_flags: u32, dw_bytes: usize) -> *mut c_void;
    fn GlobalLock(h_mem: *mut c_void) -> *mut c_void;
    fn GlobalUnlock(h_mem: *mut c_void) -> i32;
    fn GlobalFree(h_mem: *mut c_void) -> *mut c_void;
}

fn read_clipboard_text() -> Option<String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
            return None;
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return None;
        }
        let ptr = GlobalLock(handle) as *const u16;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }
        let mut len = 0usize;
        while len < 20_000 && *ptr.add(len) != 0 {
            len += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
        GlobalUnlock(handle);
        CloseClipboard();
        Some(text)
    }
}

fn write_clipboard_text(text: &str) -> Result<(), String> {
    unsafe {
        let mut units: Vec<u16> = text.encode_utf16().collect();
        units.push(0);
        let bytes = units.len() * 2;
        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if handle.is_null() {
            return Err("内存分配失败".into());
        }
        let ptr = GlobalLock(handle) as *mut u16;
        if ptr.is_null() {
            GlobalFree(handle);
            return Err("内存锁定失败".into());
        }
        std::ptr::copy_nonoverlapping(units.as_ptr(), ptr, units.len());
        GlobalUnlock(handle);

        if OpenClipboard(std::ptr::null_mut()) == 0 {
            GlobalFree(handle);
            return Err("剪贴板被其他程序占用".into());
        }
        EmptyClipboard();
        let result = SetClipboardData(CF_UNICODETEXT, handle);
        CloseClipboard();
        if result.is_null() {
            GlobalFree(handle);
            return Err("写入剪贴板失败".into());
        }
        Ok(())
    }
}

#[derive(Clone, serde::Serialize)]
struct ClipboardPayload {
    text: String,
}

#[tauri::command]
fn start_clipboard_watch() {
    WATCHING.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn stop_clipboard_watch() {
    WATCHING.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn set_paused(paused: bool) {
    PAUSED.store(paused, Ordering::SeqCst);
}

#[tauri::command]
fn set_clipboard_text(text: String) -> Result<(), String> {
    *suppress_slot().lock().map_err(|e| e.to_string())? = Some(text.clone());
    write_clipboard_text(&text)
}

#[tauri::command]
fn read_clipboard_now() -> String {
    read_clipboard_text().unwrap_or_default()
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, pinned: bool) -> Result<(), String> {
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_view(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(Size::Logical(LogicalSize { width, height }))
        .map_err(|e| e.to_string())
}

fn spawn_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = unsafe { GetClipboardSequenceNumber() };
        loop {
            std::thread::sleep(Duration::from_millis(220));
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last {
                continue;
            }
            last = seq;
            if !WATCHING.load(Ordering::SeqCst) || PAUSED.load(Ordering::SeqCst) {
                continue;
            }
            let Some(text) = read_clipboard_text() else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            if let Ok(mut guard) = suppress_slot().lock() {
                if guard.as_deref() == Some(text.as_str()) {
                    *guard = None;
                    continue;
                }
            }
            let _ = app.emit("clipboard-changed", ClipboardPayload { text });
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // 仅发布版单实例：二次启动转发到已有实例并退出；dev/debug 不注册，可多开调试
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    builder
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            #[cfg(target_os = "windows")]
            {
                use tauri::webview::Color;
                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
            }

            if !system::restore_window_state(&window) {
                let _ = window.center();
            }

            let win_for_close = window.clone();
            let app_for_events = app.handle().clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = win_for_close.hide();
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    system::schedule_window_save(app_for_events.clone());
                }
                _ => {}
            });

            let show = MenuItem::with_id(app, "show", "显示译雀", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "暂停 / 继续", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &pause, &settings, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("window icon").clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "pause" => {
                        let next = !PAUSED.load(Ordering::SeqCst);
                        PAUSED.store(next, Ordering::SeqCst);
                        let _ = app.emit("pause-changed", next);
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("open-settings", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            spawn_watcher(app.handle().clone());
            system::spawn_hotkey(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_clipboard_watch,
            stop_clipboard_watch,
            set_paused,
            set_clipboard_text,
            read_clipboard_now,
            hide_window,
            minimize_window,
            show_window,
            set_always_on_top,
            resize_view,
            http::http_request,
            dict::dict_lookup,
            dict::dict_cache_put,
            dict::dict_status,
            store::history_add,
            store::history_list,
            store::history_clear,
            store::favorite_put,
            store::favorite_remove,
            store::favorite_list,
            store::favorites_export,
            store::cache_stats,
            store::cache_clear,
            system::hotkey_set,
            system::hotkey_available,
            system::autostart_get,
            system::autostart_set,
            config::read_config,
            config::config_location,
            config::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
