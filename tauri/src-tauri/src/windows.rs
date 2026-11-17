//! Windows (main/popup), tray and global hotkeys - the parts of
//! electron/main.ts that are not IPC handlers.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use image::GenericImageView;
use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::settings::KeyboardSettings;

/// Set once the user chooses Quit (tray), so CloseRequested can let the main
/// window actually close (Electron's app.isQuitting flag).
pub static QUITTING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy)]
pub enum PopupKind { Dict, Translate }

impl PopupKind {
    pub fn label(&self) -> &'static str {
        match self { PopupKind::Dict => "popup-dict", PopupKind::Translate => "popup-translate" }
    }
    fn title(&self) -> &'static str {
        match self { PopupKind::Dict => "查词小窗", PopupKind::Translate => "翻译小窗" }
    }
    fn height(&self) -> f64 {
        match self { PopupKind::Dict => 96.0, PopupKind::Translate => 280.0 }
    }
}

/// Create-or-focus the popup window (Electron's showPopup).
pub fn show_popup(app: &AppHandle, kind: PopupKind) {
    let label = kind.label();
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("popup:show", ());
        return;
    }

    // Popup windows carry their own taskbar icon (Electron parity). The image
    // crate decodes the PNG; tauri gets raw RGBA via Image::new_owned.
    let mut icon_img: Option<Image> = None;
    if let Some(rd) = crate::state::resource_dir() {
        for candidate in [rd.join("popup-icon.png"), rd.join("resources").join("popup-icon.png")] {
            if candidate.exists() {
                match image::open(&candidate) {
                    Ok(decoded) => {
                        let (w, h) = decoded.dimensions();
                        icon_img = Some(Image::new_owned(decoded.to_rgba8().into_raw(), w, h));
                        break;
                    }
                    Err(err) => eprintln!("[popup] 图标加载失败: {}", err),
                }
            }
        }
    }

    let builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title(kind.title())
        .inner_size(480.0, kind.height())
        .min_inner_size(360.0, 80.0)
        .resizable(true)
        .maximizable(false)
        .decorations(false) // frameless: the popup draws its own title bar
        .always_on_top(true)
        .skip_taskbar(false)
        .visible(false);

    match builder.build() {
        Ok(w) => {
            if let Some(img) = icon_img {
                let _ = w.set_icon(img);
            }
            let _ = w.show();
            let _ = w.set_focus();
        }
        Err(err) => eprintln!("[popup] 创建失败: {}", err),
    }
}

/// The HotkeyRecorder emits Electron-style accelerators (CommandOrControl+...);
/// the global-hotkey crate expects CmdOrCtrl.
fn normalize_accel(a: &str) -> String {
    if a.to_lowercase().starts_with("commandorcontrol") {
        format!("CmdOrCtrl{}", &a["CommandOrControl".len()..])
    } else {
        a.to_string()
    }
}

/// (Re-)register both global shortcuts from settings (Electron's syncHotkeys).
pub fn sync_hotkeys(app: &AppHandle, kb: &KeyboardSettings) {
    let gs = app.global_shortcut();
    // Only our two shortcuts are ever registered, so a clean slate is safe.
    let _ = gs.unregister_all();

    let entries: [(&Option<String>, PopupKind); 2] =
        [(&kb.dict_hotkey, PopupKind::Dict), (&kb.translate_hotkey, PopupKind::Translate)];
    for (accel_opt, kind) in entries {
        let accel = match accel_opt {
            Some(a) if !a.trim().is_empty() => normalize_accel(a.trim()),
            _ => continue,
        };
        let shortcut = match accel.parse::<Shortcut>() {
            Ok(s) => s,
            Err(err) => {
                eprintln!("[hotkey] 无法解析加速器 {} : {:?}", accel, err);
                continue;
            }
        };
        let result = gs.on_shortcut(shortcut, move |app2: &AppHandle, _shortcut, event| {
            if matches!(event.state(), ShortcutState::Pressed) {
                show_popup(app2, kind);
            }
        });
        match result {
            Ok(()) => {}
            Err(e) => eprintln!("[hotkey] 注册失败（可能被其他程序占用）{}: {}", accel, e),
        }
    }
}

/// Tray with the same four actions as Electron's tray menu.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_main = MenuItemBuilder::with_id("show-main", "显示主窗口").build(app)?;
    let dict = MenuItemBuilder::with_id("popup-dict", "查词小窗").build(app)?;
    let translate = MenuItemBuilder::with_id("popup-translate", "翻译小窗").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show_main, &dict, &translate, &sep, &quit])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("ED")
        .on_menu_event(|app: &AppHandle, event| {
            let id = event.id().as_ref();
            match id {
                "show-main" => {
                    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
                }
                "popup-dict" => show_popup(app, PopupKind::Dict),
                "popup-translate" => show_popup(app, PopupKind::Translate),
                "quit" => {
                    QUITTING.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click toggles the main window (Electron parity).
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) { let _ = w.hide(); }
                    else { let _ = w.show(); let _ = w.set_focus(); }
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ── Window commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn window_hide(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) {
    let _ = window.close();
}

/// Hide the popup, surface the main window and ask it to navigate.
#[tauri::command]
pub fn window_switch_to_main(app: AppHandle, window: WebviewWindow, route: String, query: Option<Value>) {
    let _ = window.hide();
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        let payload = json!({ "route": route, "query": query });
        let _ = main.emit("main:navigate", payload);
    }
}

/// Resize the popup to fit its content height (Electron's window:fitContent).
#[tauri::command]
pub fn window_fit_content(window: WebviewWindow, height: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let inner = match window.inner_size() { Ok(s) => s, Err(_) => return };
    let width_logical = inner.width as f64 / scale;
    let next = height.max(80.0).min(720.0).ceil();
    let _ = window.set_size(tauri::LogicalSize::new(width_logical, next));
}
