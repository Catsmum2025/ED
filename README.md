# ED —— 离线英汉词典 / 翻译 / 词书应用

一个本地化优先的英语学习桌面应用（曾用名 CDictionary，现已更名 **ED**）：支持离线英汉词典（标准版内置约 2.5 万词条的合并词库；完整版内置 77 万词条的 ECDICT 全量词库），也可导入外部词库，流式 LLM 翻译、词书与闪卡复习、学习统计热力图、TTS 语音朗读、查词/翻译弹窗小窗 + 全局快捷键、系统托盘、开机自启等。

本项目由一个 Electron 个人项目重构而来：前端页面几乎零改动复用，主进程逻辑用 Rust（Tauri v2）重写。仓库现在只包含 Tauri 版；原 Electron 版仅作本地参考，不再入库。

详细文档入口：**[tauri/README.md](tauri/README.md)**（运行/构建、词库来源与许可、致谢、移植要点、界面约定）。

## 功能一览
- **词典查询**：离线词库（英文→中文释义、例句、比较级、词组、辨析），搜索打分支持精确/前缀/包含/模糊；中文反查按短语与词义相关度排序，自动剥离“苹果怎么说 / 水的英文是什么”这类口语问法，回车直接取最佳匹配；随机一词（优先挑有完整例句的词条）、词条浏览、生词本联动
- **词库安装 / 导入**：标准版随包分发 `dictionary.zip`（约 41 MB，合并了 ECDICT 数据并含释义、例句与辨析）；完整版随包分发 `ecdict.jsonl.gz`（约 50 MB，77 万词条全量 ECDICT，solid 压缩避免逐文件开销）。两者都在“设置 → 词典 → 解压词库”一键安装，也支持“导入词库压缩包”选择任意 zip / jsonl.gz；解压与建索引一趟完成，索引为紧凑二进制 `index.bin`（加载约 0.2 s），有进度、后台执行
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
│  ├─ src-tauri/           # Rust 后端 + tauri.conf.json + resources/（dictionary.zip / ecdict.jsonl.gz）
│  ├─ LICENSE              # MIT（代码）
│  ├─ LICENSE-DATA         # 内置词库数据许可（合并数据 CC BY-SA 4.0 / ECDICT MIT）
│  └─ README.md            # 主文档：构建、词库来源与许可、致谢、移植要点
├─ AGENTS.md               # 开发工作备忘（状态/踩坑/验证方法）
└─ (electron/ 仅本地留存，已从 git 历史移除)
```

## 快速开始
```powershell
cd tauri
pnpm install
pnpm tauri:dev                    # 热更新开发
pnpm exec tauri build --config src-tauri/tauri.conf.standard.json   # 标准版 NSIS → …/bundle/nsis/ED_0.1.0_x64-setup.exe
pnpm exec tauri build --config src-tauri/tauri.conf.full.json      # 完整版（内置 77 万 ECDICT）
powershell -File make-portable.ps1                                            # 标准版 portable
powershell -File make-portable.ps1 -Edition Full -Resource ecdict.jsonl.gz,popup-icon.png   # 完整版 portable
cd src-tauri && cargo test --bins    # 单元测试
```
> ⚠️ 重建前先结束所有 `ed.exe`/`cdictionary.exe` 进程；若构建脚本报“拒绝访问 (os error 5)”，在 src-tauri 下 `cargo clean` 后重试。更多见 [AGENTS.md](AGENTS.md)。

## 词库来源与许可 / 开源协议
内置词库有两个发行包：
- **标准版** `tauri/src-tauri/resources/dictionary.zip` 及其解压内容，由 **[ahpxex/open-dictionary](https://github.com/ahpxex/open-dictionary)**（CC BY-SA 4.0，Wiktionary/Wiktextract 衍生）与 **[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)**（MIT）合并而成，合并数据整体以 **CC BY-SA 4.0** 发布；
- **完整版** `tauri/src-tauri/resources/ecdict.jsonl.gz` 及其解压内容，以 ECDICT 全量为基础，其中约 2.5 万条已合入 open-dictionary 的释义/例句——因此同样按 **CC BY-SA 4.0** 发布。

两个数据包都包含 open-dictionary 内容，整体都按 CC BY-SA 4.0 发布；ECDICT 部分的 MIT 版权声明、许可全文与修改说明保留在 **[tauri/LICENSE-DATA](tauri/LICENSE-DATA)**。内置英文词频数据来自 wordfreq 3.1.1（作者 Robyn Speer，CC BY-SA 4.0）。数据依 ShareAlike 条款分发：再分发或二次加工时须以相同许可发布并保留署名。本项目代码以 **MIT** 开源（见 [tauri/LICENSE](tauri/LICENSE)）。完整署名、修改说明与许可证全文见 **[tauri/LICENSE-DATA](tauri/LICENSE-DATA)** 与 **[tauri/README.md](tauri/README.md)**。

> ECDICT 数据已合并进内置词典包。应用仍支持在“设置 → 词典 → 导入词库压缩包”中导入外部 ECDICT `dict_json` 大词库；外部导入数据的许可与署名要求以上游说明为准。

## 提醒
- 本项目主要由 DeepSeek Harness 搭配本地 Qwen3.8-flash-next 与 DeepSeek-v4.1-flash API 协同开发。
- 其中可能会有部分功能不完整、体验不佳，之后有机会会持续更新。
- 该项目主要功能均无需网络连接。

## 致谢
- 开源项目 [ahpxex/actionary](https://github.com/ahpxex/actionary)（主要为其先前版本 actionary-re）为本项目的原型 CDictionary 提供了大量想法和参考，万分感谢。
- 感谢词库上游 [ahpxex/open-dictionary](https://github.com/ahpxex/open-dictionary)、[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)、Wiktionary / Wiktextract 社区与 wordfreq 作者 Robyn Speer。

## 相关文档
- [tauri/README.md](tauri/README.md) —— 主 README（构建、许可、致谢、移植要点）
- [tauri/LICENSE-DATA](tauri/LICENSE-DATA) —— 内置词典数据许可与完整署名
- [AGENTS.md](AGENTS.md) —— 开发工作备忘（构建/验证正确姿势、踩坑记录、历史决策）

