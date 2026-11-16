# AGENTS.md —— 项目开发工作备忘

> 面向接手本项目的 AI 代理与开发者。记录当前状态、构建/验证的正确姿势、历史决策与踩坑。修改代码后请同步更新本文档与 README（见“文档维护规则”）。

## 1. 当前状态快照（2026-11-16）
- **主线**：`tauri/`（Tauri v2 重构版），功能已对齐 Electron 版并全部验证可用
- **git**：仓库根 = `D:/trae/CDictionary`，分支 `main`，最新提交见 `git log`（写本文档时为 `b590627 fix(dict-install): ...`，共 3 个提交）
- **产物**（本地路径，未入库）：
  - NSIS：`tauri/src-tauri/target/release/bundle/nsis/CDictionary_0.1.0_x64-setup.exe`（约 48.8 MB）
  - Portable：`tauri/release/CDictionary-0.1.0-Portable.zip`（约 52 MB，由 make-portable.ps1 生成）
  - 两者均为 2026-11-16 19:31 / 19:38 的“解压词库修复版”构建
- **运行时数据**：`%APPDATA%/com.ahpx.cdictionary/`（settings.json、index.json、stats.json、wordbooks.json、tts-cache/、dictionary/）；当前用户机上词库已安装、设置指向 `.../dictionary`，一切正常

## 2. Git 约定
- 提交身份：`git -c user.name=CDictionary -c user.email=dev@local commit ...`（本机无全局身份时用 -c 内联）
- `.gitignore` 要点：排除 `node_modules/ dist/ dist-electron/ release/ target/ tauri/src-tauri/gen/`、根级 `dictionary/` 语料（5 万文件）、`*.zip`（**例外**：`!tauri/src-tauri/resources/dictionary.zip` 必须入库，它是随包词库）、`*.*log`
- 提交历史：
  1. `6c96643` 初始导入（electron 原版 + tauri 移植源码）
  2. `548e767` Tauri 编译修复 + NSIS/portable 打包链路 + README
  3. `b590627` 解压词库功能修复（前端竞态、save 重试、单元测试、自检钩子、electron-builder.yml 补档）
- 根目录 `merged_dict_json/`、`_work/` 是用户的空目录/工作目录，git 不跟踪，**不要动**

## 3. 工具链与环境（本机实测版本）
| 工具 | 版本/位置 | 备注 |
|---|---|---|
| Node | v24.12.0 | pnpm 10.27.0；`pnpm exec tauri ...` 走本地 @tauri-apps/cli |
| Rust | cargo 1.98.1（`~/.cargo/bin`） | crates.io 可达（HEAD 探测可能 403，实际 fetch 正常） |
| Git | 2.52 | |
| WebView2 | 系统自带 | Win10/11；Win7/8 不可用 |

## 4. 构建 / 验证的正确姿势（重要！）
### 构建
```powershell
# 1) 先杀掉所有实例，否则链接/打包报 os error 5（拒绝访问）
Get-Process cdictionary -ErrorAction SilentlyContinue | ForEach-Object { taskkill /pid $_.Id /T /F }
# 2) 固定用 tauri CLI（会先跑 pnpm build 再 cargo release + NSIS），约 6-8 分钟
Set-Location D:/trae/CDictionary/tauri; pnpm exec tauri build
# 3) portable zip（Tauri 2.x 无内置 portable bundle 目标，脚本手动组装）
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1
```
- **禁止裸 `cargo build --release`**：tauri-build 的最后一步在本机以“拒绝访问 (os error 5)”失败（debug 的 `cargo build`/`cargo test` 正常）。release 产物只经 `pnpm exec tauri build` 生成
- pnpm 安装时 esbuild 的 build script 警告可忽略（vite 构建正常）

### 验证（改完必跑）
1. `cd src-tauri && cargo test --bins` —— 含对真实 dictionary.zip 的解压/flatten 单元测试（约 21s）
2. **无头端到端自检**：`CDICTIONARY_SELFTEST=install` 启动 release exe → 完整执行词库安装管线并打印后自动退出：
   ```powershell
   $env:CDICTIONARY_SELFTEST = "install"
   Start-Process <exe路径> -PassThru -RedirectStandardOutput out.log -RedirectStandardError err.log
   # 等进程退出后再读 %APPDATA%\com.ahpx.cdictionary\settings.json 验证 dictionaryPath
   ```
   ⚠️ 进程退出后 settings.json **可能还会被补写一次**（前端 watcher 的落盘在退出竞态中完成），读校验前 sleep 几秒或稍后重读，勿以第一瞬间的值定论
3. GUI 冒烟：启动 exe，8 秒后 `Get-Process` 应存活且 MainWindowWindowTitle=CDictionary

## 5. 环境怪癖 / 踩坑记录
- **PowerShell 重定向日志是 UTF-16LE**：`cmd *> file.log` 产物用 Node 读时要先 `new TextDecoder('utf-16le')`，失败再按 utf-8；曾因把乱码当“无错误”误判 cargo check 通过
- **release exe 是 GUI subsystem**：stdout 需 `Start-Process -RedirectStandardOutput` 才能捕获 println
- **pwsh7 的 Start-Process 无 -Environment 参数**：先设 `$env:VAR` 再启动（子进程继承）
- **run_code / TS 模板字符串**：内容里绝不能出现字面反引号（Rust 代码中的三反引号用 `"\x60"\u00d73` 拼接；文档里的 markdown 代码块用 ``` 时改用 write 工具直写）
- **Tauri v2 配置**：`bundle.targets` 无 `portable`（只有 nsis/msi/…）；NsisConfig 无 `oneClick`/`allowToChangeInstallationDirectory`（v1 字段，deny_unknown_fields 会拒绝）
- **Tauri 命令参数映射**：Rust snake_case ↔ JS camelCase 自动转换；JS 保留字参数写 `r#type`；async 命令带 `State<'_>` 引用参数必须返回 `Result`
- **global-shortcut 插件**：每快捷键回调是 `on_shortcut(accel.parse::<Shortcut>()?, handler)`，不是 `register_with`；accelerator 需把 Electron 的 `CommandOrControl` 归一化为 `CmdOrCtrl`（见 windows.rs::normalize_accel）
- **tray**：`TrayIconBuilder.menu(&menu)` 只传 menu（不传 app、无 Result）；图标用 `Image::new_owned(rgba,w,h)`（image crate 解码 png），2.12 无 `Image::from_path`
- **chrono**：`NaiveDate` 没有 `overflowing_sub_days`，用 `checked_sub_days(Days::new(n))`
- **杀软/索引器偶发锁定 settings.json**：save_settings 已内置 5 次×150ms 重试；写失败会 eprintln（stderr），排错时别把 stderr 重定向到 NUL

## 6. 架构速览（Tauri 版）
- **前端唯一后端入口**：`src/ipc.ts`（api 形状 = Electron preload，页面零改动）。新增能力按“Rust command → generate_handler! 注册 → ipc.ts 包装 → 组件调用”四步
- **43 条命令分组**：settings_*（2）、dict_*（8 查询/索引 + 3 安装器）、stats_*（6）、llm_* / dict_generate_word（4）、tts_*（3）、llm_*_local_model（3）、wordbooks_*（10）、window_*（4）
- **事件通道**：`dict:installProgress/Done/Error`、`translate:chunk/done/error`、`popup:show`、`main:navigate`
- **窗口 label 约定**：`main` / `popup-dict` / `popup-translate`；弹窗失焦自动隐藏（main.rs 全局 on_window_event 按 label 前缀匹配）、主窗口 CloseRequested→hide（托盘退出经 QUITTING 原子标志放行）
- **数据目录**：见 state.rs；resource_dir 里找 dictionary.zip/popup-icon.png（兼容 `<rd>/`、`<rd>/resources/` 两种布局）
- **词库安装流**：installer.rs `extract_and_flatten`（zip crate，无 PowerShell 依赖，可单测）→ 写 settings.dictionaryPath → dict.update_path → rebuild（带进度回调）→ emit Done；前端 ExtractionWatcher 负责把新路径镜像进 store（勿删！曾有陈旧回写竞态导致功能回归，见 b590627）

## 7. 历史工作时间线
1. **迁移**：原 Electron 项目整体移入 `electron/app/`；根目录建 git 仓库
2. **移植**：前端整拷 + ipc.ts 适配层重写；Rust 端按 Electron services 逐模块重写（settings/dictionary/stats/wordbooks/llm/tts/localmodel/installer/windows）；用户提供的 app-icon.png 经 `pnpm exec tauri icon` 生成全套图标
3. **编译修复轮**：共 15 处错误（import 路径、builder API 差异、插件 API、chrono、?/Result 包装等），全部记录于第 5 节；最终 cargo check/test 零警告
4. **首版产物**：NSIS + portable zip，冒烟通过（提交 548e767）
5. **解压词库修复**（用户反馈“不可用”，提交 b590627），三层根因：
   - Tauri 前端：DictionaryCache done-effect 里 `update({dictionaryPath: store旧值})` 把后端已写好的新路径覆盖回滚 → 删除该行 + ExtractionWatcher 在 installDone 时镜像新路径
   - Electron 原版：仓库缺 electron-builder 配置，装机版从未打进 dictionary.zip → 补 `electron/app/electron-builder.yml`（Electron 产物未重建）
   - 附带加固：save_settings 写盘重试（杀软锁文件场景）
   - 证据链：用户数据目录里 25321 个 json + settings.json 的 dictionaryPath 停留旧值；带日志构建抓到完整写入序列（phase3 save dest → 前端 settings_set(dest) → 落盘正确）

## 8. 已知差异 / 待办候选
- apiKey 明文存 settings.json（Electron 用 safeStorage/DPAPI，Tauri 无等价 API；可考虑迁移到 keyring 插件）
- Portable 版数据仍写 %APPDATA%；若要完全便携化需 `tauri build --config '{ "app": { "appDirectoriesOverride": "./app-data" } }'` 单独出一份
- Electron 版仅补了打包配置，未重新构建其安装产物（如需：`cd electron/app && pnpm dist:win`）
- 全局快捷键无默认值（与 Electron 行为一致，用户录制后生效）
- NSIS v2 向导行为由模板默认决定（无 oneClick 配置项）
- 未做 Windows ARM64 / MSIX；升级分发未规划

## 9. 文档维护规则
- 新增/修改命令、事件、构建步骤、产物 → 同步更新本文件 + `README.md`（根）+ `tauri/README.md`（如涉及移植差异）
- 每次重新交付产物后，更新第 1 节“产物”的时间与文件名
- git 提交信息用 conventional commits（feat/fix/chore/docs），一次逻辑变更一个提交
