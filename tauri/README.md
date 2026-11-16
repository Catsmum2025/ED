# CDictionary (Tauri 版)

Electron 版（见 ../electron/app）的 Tauri v2 重构移植，UI 与功能尽量对齐原版。

## 运行 / 构建
- 开发调试：pnpm install && pnpm tauri:dev
- 安装包（NSIS）：pnpm tauri build → src-tauri/target/release/bundle/nsis/CDictionary_0.1.0_x64-setup.exe
- Portable：先执行 pnpm tauri build，再 powershell -File make-portable.ps1 → release/CDictionary-0.1.0-Portable.zip（Tauri 2.x 无内置 portable 打包目标，此脚本把 release 产物 + resources 打成 zip）
- 图标：pnpm icon（源图 app-icon.png，tauri icon 生成 src-tauri/icons/*）
- 无头自检：设置环境变量 CDICTIONARY_SELFTEST=install 后运行 exe，会自动执行完整“解压词库”管线（找内置 zip → 解压 → flatten → 写 settings → 重建索引）并打印结果后退出，用于打包产物验证

## 移植要点（与 Electron 版的对应关系）
- electron/main.ts + services/*.ts → src-tauri/src/*.rs（Rust 重写：词典索引/搜索、词书、统计、LLM 流式翻译、IndexTTS 缓存、本地模型进程管理、词库 zip 安装器）
- preload.ts contextBridge → src/ipc.ts 适配层：用 @tauri-apps/api invoke/event 实现了与 window.electronAPI 完全同构的 api 对象，页面代码零改动复用
- 弹窗小窗（查词/翻译）：Rust 侧按需创建无边框窗口 + 失焦自动隐藏；全局快捷键无默认值，在“设置→快捷键”录制后经 tauri-plugin-global-shortcut 注册（托盘菜单也可直接唤起小窗），兼容原 Electron accelerator 写法
- tts:// 自定义协议 → Tauri asset 协议（convertFileSrc），音频缓存在 %APPDATA%/com.ahpx.cdictionary/tts-cache
- 词典安装：内置 resources/dictionary.zip 用 zip crate 解压并带进度事件（不再依赖 PowerShell/Tar）
- 系统托盘、单实例、开机自启（tauri-plugin-autostart）、目录/文件对话框、shell openPath 均以官方插件实现

## 已知差异
- apiKey 以明文存于 %APPDATA%/com.ahpx.cdictionary/settings.json（Electron 用 safeStorage/DPAPI；Tauri 无等价 API）
- Windows 7/8 不支持（WebView2）；安装器为 per-user NSIS（v2 配置中无 oneClick 字段，向导行为由模板默认决定）
- Portable 版数据仍写入 %APPDATA%/com.ahpx.cdictionary（Electron portable 是随 exe 目录存数据）。如需完全本地化，可在构建 portable 版时用：pnpm exec tauri build --config '{"app":{"appDirectoriesOverride":"./app-data"}}'
