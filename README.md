# CDictionary —— 离线英汉词典 / 翻译 / 词书应用

一个本地化优先的英语学习桌面应用：内置约 2.5 万词条离线英汉词典（可一键解压安装），支持流式 LLM 翻译、词书与闪卡复习、学习统计热力图、TTS 语音朗读、查词/翻译弹窗小窗 + 全局快捷键、系统托盘、开机自启等。

本仓库包含两个版本：

| 目录 | 说明 |
|---|---|
| `tauri/` | **当前主线** —— Tauri v2（Rust）重构版，功能与 Electron 版对齐，产物更小、启动更快 |
| `electron/app/` | 原始 Electron 版本（保留作参照，不再迭代；打包配置已补档） |

## 功能一览
- **词典查询**：离线词库（英文→中文释义、例句、比较级、词组、辨析），搜索打分支持精确/前缀/包含/模糊与中文反查；随机一词、词条浏览、生词本联动
- **内置词库安装器**：随应用分发 `dictionary.zip`（约 38 MB / 25321 文件），设置页一键“解压词库”，带三阶段进度（extract → move → index）与卸载
- **AI 翻译**：OpenAI 兼容 API（含本地模型，如 llama.cpp / LM Studio 类服务），SSE 流式输出、可自定义前缀提示词；可选“AI 生成词条”实验功能（结构化 JSON 输出直接入库）
- **词书 / 闪卡**：多词书管理、“我的关注”收藏、按词书复习闪卡
- **统计**：查询热力图（日/周/月/年）、总计、高频词榜、TXT 导出
- **语音（TTS）**：浏览器内置语音 或 IndexTTS HTTP 服务（`/v1/audio/speech`，SHA1 缓存 wav），本地模型一键启动/停止/状态查询
- **弹窗小窗**：查词小窗 / 翻译小窗（无边框、置顶、失焦自动隐藏、自绘标题栏可拖动），可由全局快捷键或托盘唤起，快捷键在“设置→快捷键”中录制
- **系统集成**：系统托盘（显示主窗口/两个小窗/退出，左键切换）、单实例、开机自启、关闭主窗口最小化到托盘
- **界面**：中/英文、明暗主题与跟随系统、强调色、UI 缩放

## 技术栈
### Tauri 版（主线）
- **后端**：Rust + Tauri v2；`reqwest`（SSE 流式翻译 / TTS multipart）、`zip`（词库解压）、`chrono`、`sha1`、`image`（弹窗图标解码）等
- **插件**：single-instance、global-shortcut、dialog、opener、autostart（官方插件全家桶）
- **前端**：React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Zustand（与 Electron 版同一套组件代码，零改动复用）
- **关键设计**：`src/ipc.ts` 适配层用 `invoke`/`listen` 复刻了 Electron preload 暴露的 `api` 对象形状，页面代码不感知宿主差异
### Electron 版（参照）
- Electron 30 + 同样的 React 前端；主进程 services/（词典索引、词书、统计、LLM、TTS、词库安装器 via PowerShell Expand-Archive）

## 目录结构
```
CDictionary/
├─ electron/app/            # 原 Electron 项目（electron-builder.yml 已补档，见下）
└─ tauri/
   ├─ src/                  # React 前端（pages/ 页面、settings/ 设置页、components/、store/ zustand）
   │  ├─ ipc.ts             # ★ Tauri IPC 适配层（所有后端调用的唯一入口）
   │  └─ main.tsx           # 按窗口 label 注入弹窗路由（popup-dict/popup-translate）
   ├─ shared/types.ts       # 前后端共享类型 + DEFAULT_SETTINGS
   ├─ src-tauri/
   │  ├─ tauri.conf.json    # 窗口/bundle/资源/capability 配置
   │  ├─ capabilities/default.json
   │  ├─ resources/dictionary.zip + popup-icon.png   # 随包词库与弹窗图标
   │  └─ src/               # ★ Rust 后端（每个模块对应 Electron 的一个 service）
   │     ├─ main.rs         # 入口：插件、43 条命令注册、托盘、窗口事件、自检钩子
   │     ├─ state.rs        # AppState + 数据目录布局
   │     ├─ settings.rs / dictionary.rs / stats.rs / wordbooks.rs
   │     ├─ llm.rs / tts.rs / localmodel.rs / installer.rs / windows.rs
   ├─ make-portable.ps1     # portable zip 打包脚本（Tauri 无内置 portable 目标）
   └─ README.md             # Tauri 版专属说明
```

## 快速开始（开发）
环境要求：Windows 10/11（WebView2）、Node.js ≥ 20 + pnpm、Rust stable-msvc + VS C++ 工具链。

```powershell
cd tauri
pnpm install
pnpm tauri:dev          # 热更新开发
# 首次运行前准备词库：设置→词典→“解压词库”，或直接把 dictionary/ 语料目录指到别处
```

## 构建产物
```powershell
cd tauri
pnpm exec tauri build                                   # NSIS 安装包 → src-tauri/target/release/bundle/nsis/
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1   # portable zip → release/CDictionary-*-Portable.zip
```
> ⚠️ 不要用裸 `cargo build --release`（本机环境会失败），构建入口固定为 `pnpm exec tauri build`；重建前先结束所有 `cdictionary.exe` 进程。详见 [AGENTS.md](AGENTS.md)。

## 二次开发指南
### 调用链
组件 → `api.xxx`（[src/ipc.ts](tauri/src/ipc.ts)）→ `invoke('命令名', args)` → Rust `#[tauri::command]`（[src-tauri/src/](tauri/src-tauri/src/)）；后端主动推送走事件（如 `dict:installProgress`/`translate:chunk`），前端在 ipc.ts 里用 `listen` 封装后订阅。

### 新增一条命令的四步
1. 在对应 Rust 模块写 `#[tauri::command] pub fn xxx(...)`（参数 snake_case，JS 侧自动映射 camelCase；JS 保留字参数用 `r#type`）
2. `main.rs` 的 `generate_handler!` 注册
3. `ipc.ts` 给 `api` 加同名包装
4. 组件里调用。事件通道同理：Rust `window.emit("chan", json!({...}))` ↔ ipc.ts `subscribe('chan', cb)`

### 数据布局（%APPDATA%\com.ahpx.cdictionary）
| 文件 | 内容 |
|---|---|
| settings.json | 全量设置（serde camelCase，与前端 DEFAULT_SETTINGS 深合并；写盘带重试） |
| index.json | 词典搜索索引（rebuild 时生成，约 14 MB） |
| stats.json / wordbooks.json | 统计与词书数据 |
| tts-cache/ | TTS wav 缓存（key=sha1(voice|rate|text)） |
| dictionary/ | “解压词库”目标目录（settings.dictionaryPath 指向它） |

### 词库语料格式
`dictionary.zip` 顶层为 `dictionary/`，内含每词一个 `<word>.json`（WordDefinition：释义/例句/比较级/辨析等）。安装器解压后 flatten 掉内层 `dictionary/` 并重建索引；目录也可通过“选择词典目录”指向任意自定义位置。

### 弹窗与快捷键约定
- 窗口 label：`main`、`popup-dict`（查词）、`popup-translate`（翻译）；弹窗按失焦自动隐藏，拖拽用 `data-tauri-drag-region`
- 全局快捷键无默认值，用户在“设置→快捷键”录制后由 `sync_hotkeys` 全量重注册（Electron accelerator 写法会被归一化为 Tauri 语法）

### 验证手段
- `cargo test --bins`：词库解压核心（对真实 zip）的单元测试
- `CDICTIONARY_SELFTEST=install` 运行 exe：无头执行完整“找包→解压→flatten→写设置→重建索引”管线并打印结果后退出，适合打包后冒烟

## Electron 版备注
原项目缺少 electron-builder 配置文件，导致装机版从未打进 `resources/dictionary.zip`（“解压词库”按钮在装机版永远禁用）。已补 [electron/app/electron-builder.yml](electron/app/electron-builder.yml)（extraResources + nsis/portable 目标），如需重建 Electron 产物：`cd electron/app && pnpm dist:win`。

## 相关文档
- [tauri/README.md](tauri/README.md) —— Tauri 版移植要点与已知差异
- [AGENTS.md](AGENTS.md) —— 开发工作要点、历史决策、构建/排错经验（供 AI 代理与开发者接手）
