# AGENTS.md —— 项目开发工作备忘

> 面向接手本项目的 AI 代理与开发者。记录当前状态、构建/验证的正确姿势、历史决策与踩坑。修改代码后请同步更新本文档与 README（见“文档维护规则”）。

## 1. 当前状态快照（2026-11-17）
- **项目已更名为 ED**（原 CDictionary）：包名 `ed`、identifier `com.ahpx.ed`、窗口/托盘标题 `ED`、产物 `ED_0.1.0_x64-setup.exe` / `ED-0.1.0-Portable.zip`、自检环境变量 `ED_SELFTEST=install`、中文反查测试字典变量 `ED_TEST_DICT`。运行时数据目录随之变为 `%APPDATA%/com.ahpx.ed/`（旧 com.ahpx.cdictionary 数据不会自动迁移，首次使用重新“解压词库”即可）
- **git**：仓库根 = `D:/trae/CDictionary`；`main` 为稳定线，2026-11-16 的 UI 重构在分支 `feat/vertical-rail-nav`（b88b5c2 / a8a41a0 / 47895f9），合并前以该分支为准
- **产物**（本地路径，未入库）：
  - NSIS：`tauri/src-tauri/target/release/bundle/nsis/ED_0.1.0_x64-setup.exe`（约 48.9 MB）
  - Portable：`tauri/release/ED-0.1.0-Portable.zip`（由 make-portable.ps1 生成，exe 名 ED.exe）
  - 均为 2026-11-17 的更名后首版构建；`ED_SELFTEST=install` 冒烟通过（新数据目录 com.ahpx.ed：词库 25321 文件、index 14.7MB、settings 持久化正确）
- **运行时数据**：`%APPDATA%/com.ahpx.ed/`（settings.json、index.json、stats.json、wordbooks.json、tts-cache/、dictionary/）；旧目录 com.ahpx.cdictionary 为历史遗留可自行删除

## 2. Git 约定
- 提交身份：`git -c user.name=CDictionary -c user.email=dev@local commit ...`（本机无全局身份时用 -c 内联）
- `.gitignore` 要点：排除 `node_modules/ dist/ dist-electron/ release/ target/ tauri/src-tauri/gen/`、根级 `dictionary/` 语料（5 万文件）、`*.zip`（**例外**：`!tauri/src-tauri/resources/dictionary.zip` 必须入库，它是随包词库）、`*.*log`
- **远端**：`origin = https://github.com/Catsmum2025/ED.git`。⚠️ 2026-11-17 起 **electron/ 已从全部 git 历史中剔除**（filter-branch）且加入 .gitignore——远端仓库只含 Tauri 版；本地磁盘上的 `electron/` 目录保留作参考但不再入库。重写前的完整历史保存在本地 tag `archive/pre-ed-history`（勿推送）
- 提交历史（下列 SHA 为 2026-11-17 历史重写**前**的存档值，见 tag `archive/pre-ed-history`；重写后 SHA 全部变化但顺序与信息不变）：
  1. `6c96643` 初始导入（electron 原版 + tauri 移植源码；历史重写后 electron 路径已不存在）
  2. `548e767` Tauri 编译修复 + NSIS/portable 打包链路 + README
  3. `b590627` 解压词库功能修复（前端竞态、save 重试、单元测试、自检钩子、electron-builder.yml 补档）
  4. `b88b5c2` UI 重构一期：左侧竖向图标导航、全局面板占位、设置二级菜单、三档动效
  5. `a8a41a0` 文档：根 README + 本工作备忘
  6. `47895f9` UI 重构二期：自定义下拉、统一圆角、中文反查打分增强 + 单元测试
- 根目录 `merged_dict_json/`、`_work/` 是用户的空目录/工作目录，git 不跟踪，**不要动**
- **存在并行编辑者时（本项目实际发生过）**：提交一律显式限定路径（`git add -- <paths>` + `git commit -m ... -- <paths>`），绝不 `git add -A`/`git commit -a`，避免把对方未完成的 WIP 卷进自己的提交；遇 `.git/index.lock` 说明另一 git 进程在跑，等它结束再重试，勿删锁强攻；编辑 AGENTS.md 前后注意对方也在改同一文件，改前先读

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
Get-Process ed, cdictionary -ErrorAction SilentlyContinue | ForEach-Object { taskkill /pid $_.Id /T /F }
# 2) 固定用 tauri CLI（会先跑 pnpm build 再 cargo release + NSIS），约 6-8 分钟
Set-Location D:/trae/CDictionary/tauri; pnpm exec tauri build
# 3) portable zip（Tauri 2.x 无内置 portable bundle 目标，脚本手动组装）
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1
```
- **构建脚本偶发“拒绝访问 (os error 5)”**：tauri-build 构建脚本/链接阶段偶发失败（疑似杀软扫描 target 里的新 exe）。**解法：`cargo clean` 后重试即可**（2026-11-17 实测一次 clean 彻底解决）；先杀进程再构建可预防大部分
- pnpm 安装时 esbuild 的 build script 警告可忽略（vite 构建正常）

### 验证（改完必跑）
1. `cd src-tauri && cargo test --bins` —— 含对真实 dictionary.zip 的解压/flatten 单元测试与中文检索打分单测（约 25s）
   - 可选（中文反查回归）：`$env:ED_TEST_DICT = "$env:APPDATA\com.ahpx.ed\dictionary"` 后运行 `cargo test --bins chinese_search_against_real_dictionary_when_available -- --nocapture`；全量 2.5 万词条扫库受杀软 IO 影响可能很慢，可先拷约 400 个样本目录验证
2. **无头端到端自检**：`ED_SELFTEST=install` 启动 release exe → 完整执行词库安装管线并打印后自动退出：
   ```powershell
   $env:ED_SELFTEST = "install"
   Start-Process <exe路径> -PassThru -RedirectStandardOutput out.log -RedirectStandardError err.log
   # 等进程退出后再读 %APPDATA%\com.ahpx.ed\settings.json 验证 dictionaryPath
   ```
   ⚠️ 进程退出后 settings.json **可能还会被补写一次**（前端 watcher 的落盘在退出竞态中完成），读校验前 sleep 几秒或稍后重读，勿以第一瞬间的值定论
3. GUI 冒烟：启动 exe（ed.exe），8 秒后 `Get-Process` 应存活且 MainWindowWindowTitle=ED

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
- **前端外壳**：`components/Nav.tsx` 左侧 fixed 竖向图标导航（全高圆角卡片、底部隔线放设置与 `/dashboard`）；`components/Layout.tsx` 用 `.app-main` 预留导航偏移并按 pathname 重放入场动画
- **设计系统**：圆角统一为 4/8/12/16/full（tailwind.config.js 的 borderRadius + index.css 的 --radius 变量）；下拉统一用 `components/Select.tsx`（自定义 listbox，默认下滑展开、空间不足向上翻转、键盘/ARIA 完整），**禁止原生 select**
- **动效三档**：settings.motion（lively/calm/performance）→ SettingsLoader 写到 `<html data-motion>` → index.css 的 --dur/--ease/--page-shift 等令牌驱动全部动画；performance 档全局 1ms 并去掉导航毛玻璃
- **中文反查**：dictionary.rs 的 `normalize_chinese_query`（剥离“怎么说/的英文/是什么意思”等问法）+ `score_chinese`（concise 加权、短语 > 起始 > 包含 > 相邻 bigram ≥50% > 字符覆盖 ≥60%，长度惩罚）；前端回车直接取排名第一的候选

- **ECDICT 大词库适配（分支 feat/ecdict-770k）**：支持 dict_json 单词语义（phonetic/translation/definition/tags/exchange）；索引改为二进制 index.bin（紧凑 blob + 记录表，770k 约 90 MB，加载 ~0.2 s）；索引构建用 rayon 分批并行（770k 本机约 4 分钟）；中文排序 = 词头 POS 40 + 首义边界 120 + 常用标签（zk/gk +60、cet4/cet6 +20、ky/toefl/ielts/gre +10、任意 +30），例句不入索引；导入 zip 时解压与解析同趟完成（extract_and_build），设置页支持“导入词库压缩包”；建索引期间 INDEXING 置位，dict_* 命令快速返回空而不是阻塞；路径变更后后台重建
- **ECDICT 回归**：`$env:EDICT_TEST_DICT='D:\ecdict\dict_json\dict_json'; cargo test --bins build_full_ecdict_index_when_available -- --ignored --nocapture`（约 4 分钟）；小样本可设 EDICT_TEST_MIN 并把变量指向 ~1000 个 JSON 的目录

## 7. 历史工作时间线
1. **迁移**：原 Electron 项目整体移入 `electron/app/`；根目录建 git 仓库
2. **移植**：前端整拷 + ipc.ts 适配层重写；Rust 端按 Electron services 逐模块重写（settings/dictionary/stats/wordbooks/llm/tts/localmodel/installer/windows）；用户提供的 app-icon.png 经 `pnpm exec tauri icon` 生成全套图标
3. **编译修复轮**：共 15 处错误（import 路径、builder API 差异、插件 API、chrono、?/Result 包装等），全部记录于第 5 节；最终 cargo check/test 零警告
4. **首版产物**：NSIS + portable zip，冒烟通过（提交 548e767）
5. **UI 重构**（提交 b88b5c2 / 47895f9）：竖向图标导航 + 全局面板占位 + 设置二级菜单；动效三档；原生 select 全部替换为自定义下拉；圆角统一；中文反查打分重写
6. **解压词库修复**（用户反馈“不可用”，提交 b590627），三层根因：
   - Tauri 前端：DictionaryCache done-effect 里 `update({dictionaryPath: store旧值})` 把后端已写好的新路径覆盖回滚 → 删除该行 + ExtractionWatcher 在 installDone 时镜像新路径
   - Electron 原版：仓库缺 electron-builder 配置，装机版从未打进 dictionary.zip → 补 `electron/app/electron-builder.yml`（Electron 产物未重建）
   - 附带加固：save_settings 写盘重试（杀软锁文件场景）
   - 证据链：用户数据目录里 25321 个 json + settings.json 的 dictionaryPath 停留旧值；带日志构建抓到完整写入序列（phase3 save dest → 前端 settings_set(dest) → 落盘正确）
7. **更名 ED + 开源合规 + git 重排**（2026-11-17）：全项目 CDictionary→ED（包名/identifier/标题/产物/环境变量，详见第 1 节）；新增 LICENSE(MIT)、README“词库来源与许可”（上游 ahpxex/open-dictionary，CC BY-SA 4.0 / wordfreq 署名）与致谢（ahpxex/actionary 想法原型）、关于页内嵌声明；把写死的开发机默认词库路径改为空串。git：electron/ 从全部历史剔除 + .gitignore 排除，重写前完整历史存于 tag `archive/pre-ed-history`，force push origin main。构建偶发 os error 5 用 `cargo clean` 解决

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
