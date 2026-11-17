# ED —— 离线英汉词典 / 翻译 / 词书应用

一个本地化优先的英语学习桌面应用（曾用名 CDictionary，现已更名 **ED**）：支持离线英汉词典（内置约 2.5 万词条，或导入 77 万词条的 ECDICT dict_json 大词库），流式 LLM 翻译、词书与闪卡复习、学习统计热力图、TTS 语音朗读、查词/翻译弹窗小窗 + 全局快捷键、系统托盘、开机自启等。

本项目由一个 Electron 个人项目重构而来：前端页面几乎零改动复用，主进程逻辑用 Rust（Tauri v2）重写。仓库现在只包含 Tauri 版；原 Electron 版仅作本地参考，不再入库。

详细文档入口：**[tauri/README.md](tauri/README.md)**（运行/构建、词库来源与许可、致谢、移植要点、界面约定）。

## 功能一览
- **词典查询**：离线词库（英文→中文释义、例句、比较级、词组、辨析），搜索打分支持精确/前缀/包含/模糊；中文反查按短语与词义相关度排序，自动剥离“苹果怎么说 / 水的英文是什么”这类口语问法，回车直接取最佳匹配；随机一词（优先挑有完整例句的词条）、词条浏览、生词本联动
- **词库安装 / 导入**：随应用分发 `dictionary.zip`（约 41 MB / 25179 文件，含释义、例句与辨析），也可“导入词库压缩包”选择任意 zip；解压与建索引一趟完成。支持 ECDICT dict_json 大词库（约 243 MB / 770,109 条），索引为紧凑二进制 `index.bin`（加载约 0.2 s），解压/索引有进度、后台执行
- **AI 翻译**：OpenAI 兼容 API（含本地模型，如 llama.cpp / LM Studio / Unsloth Studio 类服务），SSE 流式输出、可自定义前缀提示词；可选“AI 生成词条”实验功能（结构化 JSON 输出直接入库）
- **词书 / 闪卡**：多词书管理、“我的关注”收藏、按词书复习闪卡
- **统计**：查询热力图（日/周/月/年）、总计、高频词榜、TXT 导出
- **语音（TTS）**：浏览器内置语音 或 IndexTTS HTTP 服务（SHA1 缓存 wav），本地模型一键启动/停止/状态查询
- **弹窗小窗**：查词 / 翻译小窗（无边框、置顶、失焦自动隐藏、可拖动），全局快捷键或托盘唤起
- **系统集成**：托盘、单实例、开机自启、关闭主窗口最小化到托盘
- **界面**：左侧竖向图标导航栏；中/英文、明暗主题、强调色、UI 缩放；三档动效（活泼 / 克制 / 性能）

## 技术栈
- **后端**：Rust + Tauri v2（reqwest SSE、zip、chrono、sha1、image）+ 官方插件（single-instance、global-shortcut、dialog、opener、autostart）
- **前端**：React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Zustand；`src/ipc.ts` 适配层统一封装 invoke/event

## 目录结构
```
ED/
├─ tauri/                  # ★ 项目主体（Tauri v2）
│  ├─ src/                 # React 前端（ipc.ts = 唯一后端入口）
│  ├─ shared/types.ts      # 前后端共享类型 + DEFAULT_SETTINGS
│  ├─ src-tauri/           # Rust 后端 + tauri.conf.json + resources/dictionary.zip
│  ├─ LICENSE              # MIT（代码）
│  └─ README.md            # 主文档：构建、词库来源与许可、致谢、移植要点
├─ AGENTS.md               # 开发工作备忘（状态/踩坑/验证方法）
└─ (electron/ 仅本地留存，已从 git 历史移除)
```

## 快速开始
```powershell
cd tauri
pnpm install
pnpm tauri:dev                    # 热更新开发
pnpm exec tauri build             # NSIS → src-tauri/target/release/bundle/nsis/ED_0.1.0_x64-setup.exe
powershell -File make-portable.ps1   # portable → release/ED-0.1.0-Portable.zip
cd src-tauri && cargo test --bins    # 单元测试
```
> ⚠️ 重建前先结束所有 `ed.exe`/`cdictionary.exe` 进程；若构建脚本报“拒绝访问 (os error 5)”，在 src-tauri 下 `cargo clean` 后重试。更多见 [AGENTS.md](AGENTS.md)。

## 词库来源与许可 / 开源协议
词条数据来自上游项目 **[ahpxex/open-dictionary](https://github.com/ahpxex/open-dictionary)**（CC BY-SA 4.0，Wiktionary/Wiktextract 衍生）；内置英文词频数据来自 wordfreq 3.1.1（作者 Robyn Speer，CC BY-SA 4.0）。数据依 ShareAlike 条款分发：再分发或二次加工时须以相同许可发布并保留署名。本项目代码以 **MIT** 开源（见 [tauri/LICENSE](tauri/LICENSE)）。完整声明与致谢见 **[tauri/README.md](tauri/README.md)**。

> ECDICT（[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)）为可选外部词库：需自行下载 `dict_json` 后在应用内“导入词库压缩包”或指定目录，本仓库不随包分发其数据；其数据许可与署名要求以上游说明为准。

## 提醒
- 本项目主要由 DeepSeek Harness 搭配本地 Qwen3.8-flash-next 与 DeepSeek-v4.1-flash API 协同开发。
- 其中可能会有部分功能不完整、体验不佳，之后有机会会持续更新。
- 该项目主要功能均无需网络连接。

## 致谢
- 开源项目 [ahpxex/actionary](https://github.com/ahpxex/actionary)（主要为其先前版本 actionary-re）为本项目的原型 CDictionary 提供了大量想法和参考，万分感谢。
- 感谢词库上游 [ahpxex/open-dictionary](https://github.com/ahpxex/open-dictionary)、Wiktionary / Wiktextract 社区与 wordfreq 作者 Robyn Speer。

## 相关文档
- [tauri/README.md](tauri/README.md) —— 主 README（构建、许可、致谢、移植要点）
- [AGENTS.md](AGENTS.md) —— 开发工作备忘（构建/验证正确姿势、踩坑记录、历史决策）
