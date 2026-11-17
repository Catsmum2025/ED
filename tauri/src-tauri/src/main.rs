#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! CDictionary (Tauri port). Entry point wiring services, plugins, tray,
//! hotkeys and every command that mirrors the Electron main process.

mod dictionary;
mod installer;
mod llm;
mod localmodel;
mod settings;
mod state;
mod stats;
mod tts;
mod windows;
mod wordbooks;

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use state::AppState;
use tauri::{Manager, RunEvent, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Minimize to tray instead of quitting when clicking the X on the
        // main window (Electron close handler parity; tray Quit sets QUITTING).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !windows::QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // Popups auto-hide when the user clicks away (Electron parity).
            if window.label().starts_with("popup-") {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir).ok();
            state::set_data_dir(data_dir);
            if let Ok(rd) = app.path().resource_dir() {
                state::set_resource_dir(rd);
            }

            let settings_val = settings::load_settings();
            let dict = dictionary::DictionaryService::new(settings_val.dictionary_path.clone());
            app.manage(AppState {
                settings: Mutex::new(settings_val),
                dict: Mutex::new(dict),
                stats: Mutex::new(stats::StatsService::new()),
                books: Mutex::new(wordbooks::WordBookService::new()),
                local_model: Mutex::new(localmodel::LocalModel::new()),
            });

            // Warm the dictionary index in the background so window creation
            // is never blocked (50k+ entries take a moment).
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    let st = h.state::<AppState>();
                    st.dict.lock().unwrap().initialize();
                });
            }

            windows::build_tray(&handle).ok();

            {
                let st = handle.state::<AppState>();
                let s = st.settings.lock().unwrap();
                windows::sync_hotkeys(&handle, &s.keyboard);
            }

            // Sync the login-item setting on startup so our stored value wins.
            {
                use tauri_plugin_autostart::ManagerExt;
                let al = handle.autolaunch();
                let st = handle.state::<AppState>();
                let s = st.settings.lock().unwrap();
                if s.system.launch_at_login { let _ = al.enable(); } else { let _ = al.disable(); }
            }

            // Auto-launch the local model together with the app if configured.
            {
                let st = handle.state::<AppState>();
                let cmd = localmodel::effective_local_command(&st.settings.lock().unwrap());
                if !cmd.is_empty() {
                    st.local_model.lock().unwrap().start(&cmd);
                }
            }

            // Developer hook: run with CDICTIONARY_SELFTEST=install to exercise the
            // whole dictionary-install pipeline (bundled-zip lookup -> extract ->
            // flatten -> settings persistence -> index rebuild) and then exit.
            // Used to verify packaged artifacts headlessly.
            if std::env::var("CDICTIONARY_SELFTEST").ok().as_deref() == Some("install") {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let zip = installer::find_bundled_zip().unwrap_or_else(|| "<none>".into());
                    println!("[selftest] bundled zip: {zip}");
                    let dest = state::default_dictionary_dir();
                    println!("[selftest] dest dir: {}", dest.display());
                    if let Some(win) = h.get_webview_window("main") {
                        match installer::run_install(&win, &zip, &dest) {
                            Ok(()) => println!("[selftest] run_install OK"),
                            Err(err) => println!("[selftest] run_install FAILED: {err}"),
                        }
                    } else {
                        println!("[selftest] main window not found");
                    }
                    let st = h.state::<AppState>();
                    let s = st.settings.lock().unwrap();
                    println!("[selftest] persisted dictionaryPath: {}", s.dictionary_path);
                    drop(s);
                    println!("[selftest] index status: {:?}", st.dict.lock().unwrap().status());
                    let _ = h.exit(0);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::settings_get,
            settings::settings_set,
            dictionary::dict_search,
            dictionary::dict_get_word,
            dictionary::dict_get_words,
            dictionary::dict_rebuild_index,
            dictionary::dict_index_status,
            dictionary::dict_add_word,
            dictionary::dict_delete_word,
            dictionary::dict_random_word,
            installer::dict_can_install,
            installer::dict_install,
            installer::dict_import_zip,
            installer::dict_uninstall,
            stats::stats_record,
            stats::stats_overview,
            stats::stats_heatmap,
            stats::stats_top_words,
            stats::stats_delete_word,
            stats::stats_write_export,
            llm::llm_list_models,
            llm::llm_test_connection,
            llm::translate_stream,
            llm::dict_generate_word,
            tts::tts_synthesize,
            tts::tts_list_voices,
            tts::tts_check_health,
            localmodel::llm_start_local_model,
            localmodel::llm_stop_local_model,
            localmodel::llm_local_model_status,
            wordbooks::wordbooks_list,
            wordbooks::wordbooks_get,
            wordbooks::wordbooks_create,
            wordbooks::wordbooks_update,
            wordbooks::wordbooks_delete,
            wordbooks::wordbooks_add_word,
            wordbooks::wordbooks_remove_word,
            wordbooks::wordbooks_toggle_favorite,
            wordbooks::wordbooks_is_favorited,
            wordbooks::wordbooks_containing_word,
            windows::window_hide,
            windows::window_close,
            windows::window_switch_to_main,
            windows::window_fit_content,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // Stop any local model process we started (Electron before-quit parity).
                if let Some(st) = app_handle.try_state::<AppState>() {
                    st.local_model.lock().unwrap().stop();
                }
            }
        });
}
