use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Manager, Position, Size};

use crate::config;

/* ---------- 窗口位置 / 尺寸记忆 ---------- */

fn state_path() -> Result<std::path::PathBuf, String> {
    let cfg = config::config_path()?;
    let dir = cfg.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    Ok(dir.join("window-state.json"))
}

/// 启动时恢复上次的窗口坐标与尺寸（逻辑像素，跨缩放比例稳定）。返回是否应用了存档。
pub fn restore_window_state(window: &tauri::WebviewWindow) -> bool {
    let Ok(path) = state_path() else { return false };
    let Ok(raw) = std::fs::read_to_string(&path) else { return false };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { return false };
    let num = |k: &str| v.get(k).and_then(serde_json::Value::as_f64);
    let (Some(x), Some(y), Some(w), Some(h)) = (num("x"), num("y"), num("w"), num("h")) else { return false };
    if !(320.0..=4000.0).contains(&w) || !(240.0..=4000.0).contains(&h) {
        return false;
    }
    let _ = window.set_size(Size::Logical(tauri::LogicalSize { width: w, height: h }));
    let _ = window.set_position(Position::Logical(tauri::LogicalPosition { x, y }));
    true
}

fn save_window_state(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let v = serde_json::json!({
        "x": pos.x as f64 / scale,
        "y": pos.y as f64 / scale,
        "w": size.width as f64 / scale,
        "h": size.height as f64 / scale,
    });
    let path = state_path()?;
    std::fs::write(&path, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
        .map_err(|e| format!("保存窗口状态失败：{e}"))
}

static SAVE_PENDING: AtomicBool = AtomicBool::new(false);

/// 移动 / 缩放后防抖落盘：500ms 内的连续事件只写一次。
pub fn schedule_window_save(app: tauri::AppHandle) {
    if SAVE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        SAVE_PENDING.store(false, Ordering::SeqCst);
        if let Some(w) = app.get_webview_window("main") {
            let _ = save_window_state(&w);
        }
    });
}

/* ---------- 全局热键（Ctrl+Alt+T 唤出 / 隐藏） ---------- */

const WM_HOTKEY: u32 = 0x0312;
const MOD_CONTROL: u32 = 0x0002;
const MOD_ALT: u32 = 0x0001;
const VK_T: u32 = 0x54;
const HOTKEY_ID: i32 = 1;

static HOTKEY_ENABLED: AtomicBool = AtomicBool::new(true);
static HOTKEY_REGISTERED: AtomicBool = AtomicBool::new(false);

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
struct Msg {
    hwnd: *mut c_void,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    pt: Point,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn RegisterHotKey(h_wnd: *mut c_void, id: i32, fs_modifiers: u32, vk: u32) -> i32;
    fn UnregisterHotKey(h_wnd: *mut c_void, id: i32) -> i32;
    fn GetMessageW(lp_msg: *mut Msg, h_wnd: *mut c_void, min: u32, max: u32) -> i32;
}

fn toggle_window(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    if w.is_minimized().unwrap_or(false) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    } else if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 独立线程注册热键并跑消息循环；hwnd 传 NULL 时 WM_HOTKEY 投递到本线程队列。
pub fn spawn_hotkey(app: tauri::AppHandle) {
    std::thread::spawn(move || unsafe {
        if RegisterHotKey(std::ptr::null_mut(), HOTKEY_ID, MOD_CONTROL | MOD_ALT, VK_T) == 0 {
            HOTKEY_REGISTERED.store(false, Ordering::SeqCst);
            return;
        }
        HOTKEY_REGISTERED.store(true, Ordering::SeqCst);
        let mut msg: Msg = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_HOTKEY && msg.w_param == HOTKEY_ID as usize
                && HOTKEY_ENABLED.load(Ordering::SeqCst)
            {
                toggle_window(&app);
            }
        }
        UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
    });
}

#[tauri::command]
pub fn hotkey_set(enabled: bool) -> Result<(), String> {
    if !HOTKEY_REGISTERED.load(Ordering::SeqCst) {
        return Err("全局热键注册失败（可能被其他程序占用）".into());
    }
    HOTKEY_ENABLED.store(enabled, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn hotkey_available() -> bool {
    HOTKEY_REGISTERED.load(Ordering::SeqCst)
}

/* ---------- 开机自启（HKCU Run，默认关） ---------- */

const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as isize;
const KEY_QUERY_VALUE: u32 = 0x0001;
const KEY_SET_VALUE: u32 = 0x0002;
const REG_SZ: u32 = 1;
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "YiJianClipboardTranslator";

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegOpenKeyExW(h_key: isize, lp_sub_key: *const u16, ul_options: u32, sam_desired: u32, phk_result: *mut isize) -> i32;
    fn RegSetValueExW(h_key: isize, lp_value_name: *const u16, reserved: u32, dw_type: u32, lp_data: *const u8, cb_data: u32) -> i32;
    fn RegDeleteValueW(h_key: isize, lp_value_name: *const u16) -> i32;
    fn RegQueryValueExW(h_key: isize, lp_value_name: *const u16, lp_reserved: *mut u32, lp_type: *mut u32, lp_data: *mut u8, lpcb_data: *mut u32) -> i32;
    fn RegCloseKey(h_key: isize) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn open_run_key(access: u32) -> Option<isize> {
    let sub = wide(RUN_KEY);
    let mut handle: isize = 0;
    let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, sub.as_ptr(), 0, access, &mut handle) };
    if rc == 0 {
        Some(handle)
    } else {
        None
    }
}

#[tauri::command]
pub fn autostart_get() -> bool {
    let Some(handle) = open_run_key(KEY_QUERY_VALUE) else { return false };
    let name = wide(RUN_VALUE);
    let rc = unsafe {
        RegQueryValueExW(handle, name.as_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut())
    };
    unsafe { RegCloseKey(handle) };
    rc == 0
}

#[tauri::command]
pub fn autostart_set(enabled: bool) -> Result<(), String> {
    let Some(handle) = open_run_key(KEY_SET_VALUE) else {
        return Err("无法打开注册表 Run 键".into());
    };
    let name = wide(RUN_VALUE);
    let rc = if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = wide(&format!("\"{}\"", exe.display()));
        unsafe {
            RegSetValueExW(handle, name.as_ptr(), 0, REG_SZ, cmd.as_ptr() as *const u8, (cmd.len() * 2) as u32)
        }
    } else {
        unsafe { RegDeleteValueW(handle, name.as_ptr()) }
    };
    unsafe { RegCloseKey(handle) };
    // 删除时值不存在（2）也算成功
    if rc == 0 || (!enabled && rc == 2) {
        Ok(())
    } else {
        Err(format!("写入注册表失败（错误码 {rc}）"))
    }
}