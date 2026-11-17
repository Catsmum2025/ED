# ED

一款极简的本地英汉词典 / 翻译 / 词书桌面应用（Tauri v2 + Rust + React）。离线查词、流式 LLM 翻译、词书与闪卡、学习统计、TTS 语音、查词/翻译弹窗小窗与全局快捷键。

本项目由一个 Electron 个人项目重构而来（早期名为 CDictionary，现已更名 ED）：前端页面几乎零改动复用，主进程逻辑用 Rust 重写于 `src-tauri/src/`。

## 运行 / 构建
- 开发调试：pnpm install && pnpm tauri:dev
- 安装包（NSIS）：pnpm exec tauri build → src-tauri/target/release/bundle/nsis/ED_0.1.0_x64-setup.exe
- Portable：先执行 pnpm exec tauri build，再 powershell -File make-portable.ps1 → release/ED-0.1.0-Portable.zip（Tauri 2.x 无内置 portable 打包目标，此脚本把 release 产物 + resources 打成 zip）
- 图标：pnpm icon（源图 app-icon.png，tauri icon 生成 src-tauri/icons/*）
- 无头自检：设置环境变量 ED_SELFTEST=install 后运行 exe，会自动执行完整“解压词库”管线（找内置 zip → 解压 → flatten → 写 settings → 重建索引）并打印结果后退出，用于打包产物验证
- 单元测试：cd src-tauri && cargo test --bins

## 词库来源与许可

词条数据来自上游项目 [ahpxex/open-dictionary](https://github.com/ahpxex/open-dictionary) —— 一部以 Wiktionary/Wiktextract 快照为基础、再用大模型补写学习者向解释的开源英汉词典，当前收录 84,212 个词条。

ED 只是它的一个消费者：随安装包分发的是上游词库的一份 JSON 导出快照（`src-tauri/resources/dictionary.zip`，约 2.5 万文件 / 41 MB，含 AI 补写的释义、例句与近义辨析），在“设置 → 词典 → 解压词库”时安装到本地使用。词库的构建管线、选词规则和释义质量由上游负责，相关问题请到[上游仓库](https://github.com/ahpxex/open-dictionary)反馈。

### 许可
| 内容 | 许可 |
|---|---|
| 上游词典数据 | CC BY-SA 4.0，Wiktionary 内容的衍生作品 |
| 内置英文词频数据 | CC BY-SA 4.0，来自 wordfreq 3.1.1，作者 Robyn Speer；完整署名与来源保存在上游独立数据库中，见上游的数据说明 |
| 上游词典与本项目代码 | MIT（代码见 [LICENSE](LICENSE)） |

数据依 ShareAlike 条款分发：再分发或二次加工时须以相同许可发布，并保留对应数据源的署名与许可信息。

## 致谢
- 感谢词库上游项目 [ahpxex/open-dictionary](https://github.com/ahpxex/open-dictionary) 提供全部词条数据；
- 感谢 [ahpxex/actionary](https://github.com/ahpxex/actionary) 项目提供的想法与原型——ED 的产品形态深受其启发；
- 感谢 Wiktionary / Wiktextract 社区与 wordfreq 作者 Robyn Speer。

本项目开源，代码以 MIT 许可发布（见 [LICENSE](LICENSE)）。

## 大词库支持（ECDICT dict_json，77 万词条）
- 两种词库数据都支持：旧版每词一个富化 JSON（约 2.5 万条）与 ECDICT dict_json（770,109 个 JSON，约 294 MB；字段 word / phonetic / translation / definition / tags / exchange，约 1.5% 带富化 definitions 与例句）
- 读取时自动归一化：phonetic→音标、translation 首行→简洁释义、空 definitions 按换行拆成释义卡（isnormal=0 的词条因此仍有基础中文释义 + 英文定义）、exchange（s: / p: / d: / i: / 3: / r: / t:）→ 词形标签
- 索引从 index.json 改为紧凑二进制 **index.bin**：770k 条约 115 MB，启动加载约 0.2 s；搜索并行扫描，中文按“词头 POS + 释义边界 + 常用标签（zk/gk/cet4…）”排序，例句不参与中文检索（避免“量子纠缠”被姓名的例句命中）
- “每日随机”只从 isnormal=1（有完整释义与例句）的词条中抽取，一次文件读取即可返回，不再连续试探
- 导入方式：
  1. 设置 → 词典 → “导入词库压缩包”，选择 dict_json.zip（解压的同时解析并建立索引，只需一趟）
  2. 或把 dictionaryPath 直接指向已解压目录（首次在后台建索引，约 4 分钟，期间搜索显示构建提示）
- 解压/建索引全程有进度；大词库导入与卸载需要数分钟，UI 不阻塞。示例：
  ```powershell
  $env:EDICT_TEST_DICT = "<解压后的 dict_json 目录>"
  cd tauri/src-tauri
  cargo test --bins build_full_ecdict_index_when_available -- --ignored --nocapture
  # 小样本先验证：EDICT_TEST_DICT 指向 ~1000 个 JSON 的目录，EDICT_TEST_MIN=1000
  ```

## 移植要点（与 Electron 版的对应关系）
- electron/main.ts + services/*.ts → src-tauri/src/*.rs（Rust 重写：词典索引/搜索、词书、统计、LLM 流式翻译、IndexTTS 缓存、本地模型进程管理、词库 zip 安装器）
- preload.ts contextBridge → src/ipc.ts 适配层：用 @tauri-apps/api invoke/event 实现了与 window.electronAPI 完全同构的 api 对象，页面代码零改动复用
- 弹窗小窗（查词/翻译）：Rust 侧按需创建无边框窗口 + 失焦自动隐藏；全局快捷键无默认值，在“设置→快捷键”录制后经 tauri-plugin-global-shortcut 注册（托盘菜单也可直接唤起小窗），兼容原 Electron accelerator 写法
- tts:// 自定义协议 → Tauri asset 协议（convertFileSrc），音频缓存在 %APPDATA%/com.ahpx.ed/tts-cache
- 词典安装：内置 resources/dictionary.zip 用 zip crate 解压并带进度事件（不再依赖 PowerShell/Tar）
- 系统托盘、单实例、开机自启（tauri-plugin-autostart）、目录/文件对话框、shell openPath/openUrl 均以官方插件实现

## 界面与交互约定（2026-11 UI 重构）
- 外壳：左侧竖向图标导航栏（fixed 全高圆角卡片，底部隔线放“设置”与“全局面板”）；主内容通过 `.app-main` 预留导航偏移，页面切换有入场动画
- 设计标尺：圆角统一为 4 / 8 / 12 / 16 / full 五档（tailwind.config.js + index.css 的 --radius 变量），不要再引入新的任意圆角值
- 下拉：统一使用 `src/components/Select.tsx`（自定义 listbox：默认向下滑出、空间不足自动向上翻转、圆角/填充/阴影与卡片一致、支持键盘与 ARIA），禁止使用原生 select
- 动效：设置 → 通用 → 动画效果（lively / calm / performance）；SettingsLoader 把档位写到 `<html data-motion>`，index.css 用 CSS 变量令牌驱动全部动画；新增动画请使用 --dur/--ease/--page-shift 等令牌，性能档会全局禁用
- 全局面板：/dashboard 为多软件互联占位页（敬请期待）

## 已知差异 / 注意事项
- apiKey 以明文存于 %APPDATA%/com.ahpx.ed/settings.json（Electron 版用 safeStorage/DPAPI；Tauri 无等价 API，待迁移 keyring）
- Windows 7/8 不支持（WebView2）；安装器为 per-user NSIS（v2 配置中无 oneClick 字段，向导行为由模板默认决定）
- Portable 版数据仍写入 %APPDATA%/com.ahpx.ed。如需完全本地化，可在构建 portable 版时用：pnpm exec tauri build --config '{"app":{"appDirectoriesOverride":"./app-data"}}'
- 从旧版 CDictionary（identifier com.ahpx.cdictionary）升级的用户：数据目录随 identifier 变为 %APPDATA%/com.ahpx.ed，旧设置不会自动迁移；首次使用请重新“解压词库”
