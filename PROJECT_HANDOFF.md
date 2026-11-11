# 译雀 · 项目交接说明（迁移至 Qoder 继续开发）

> 交接快照：2026-11-11，功能基线 `3fadcb4`（`main` 分支第 10 个提交），产品版本 `0.1.0`；本交接文档与 README 的事实校正是其后的一个纯文档提交。
> **重要**：工作树其后又推进了多轮（本地词典单词详解、模型精简到四个、单词模型固定 deepseek、上限 2000、2026-11-11 体验优化轮、以及 2026-11-12 改名译雀/Sparrow + 8 款配色方案轮）。下文第 2/4.3/5/9/10/11/13/15 节已同步到**当前基线**；凡描述「六引擎 / 词典未实现 / json_schema / 背景底色 / 多巴胺」的段落均为历史，**当前权威口径以 README、TEST_REPORT 第十五·十六·十七节、以及本文第 16 节为准**。
> 本文档面向**接手开发者 / Qoder**，目标是解压后不看聊天记录也能完整理解、构建、运行、测试和继续开发。
> 阅读顺序建议：第 1–3 节（这是什么）→ 第 6 节（先跑起来）→ 第 4/5/8 节（改代码前必读）→ 第 16 节（当前基线增量）→ 第 10/11/13 节（验证与后续）。

---

## 1. 项目一句话定位

**译雀**（英文名 **Sparrow**，2026-11-12 由「译笺」改名）是一款 Windows 桌面剪贴板翻译小工具：复制任意文本，工具自动识别方向并给出译文，不流式、一次性返回完整结果，显示在一个 360×560 的无边框悬浮窗里。左上角品牌名随界面语言中英切换。

- 核心诉求（用户反复强调，优先级高于任何历史文档）：**极致轻量化且十分美观**。
- 当前翻译方案：**大模型翻译句子**（四个模型可选）＋**本地词典 + AI 兜底翻译单词**（英→中单个英文单词出词典卡，已实现）。
- 不要流式输出；配置改动实时保存、不设保存按钮。

## 2. 当前状态速览

| 项目 | 状态 |
|---|---|
| 句子翻译（四模型） | ✅ 已实现、实测通过：`hy-mt2-pro/plus/lite` + `deepseek-v4.1-flash-1017`，初次默认 pro |
| 单词详解（词典卡） | ✅ 已实现：英→中单个英文单词，本地 ECDICT 优先，未收录走 AI JSON 兜底（**固定 deepseek**）并缓存 |
| 相关词条 | ❌ 已下线（历史上问题过多，用户决定搁置）；设置页占位行已删 |
| 体验优化轮（2026-11-11） | ✅ 历史/生词本/导出、加载进度感、错误提示、窗口记忆、全局热键、缓存管理、开机自启（默认关），详见第 16 节 |
| 改名 + 配色轮（2026-11-12） | ✅ 译笺→**译雀 / Sparrow**（品牌名+窗口标题随界面语言切换）；背景底色/多巴胺→**8 款配色方案**（默认雾隐 brume），详见 TEST_REPORT 第十七节 |
| 词典卡 / json_schema / 行格式 `B\|` `S\|` / word-lean 精简模式 | ❌ 全部推翻，代码已删除，勿从 git 历史里复活（现行词典卡是 SQLite + JSON 兜底，非旧方案） |
| `preview.html` | 静态视觉基准，不参与程序运行 |
| `preview-morandi.html` | 用户自行创建的另一份视觉稿（git 未跟踪），未修改 |
| 发布版 | 2026-11-12 最新打包 **译雀 1.0** 便携 exe 交付到 `E:\译雀1.0`（译雀.exe + 无密钥 config + 使用说明.txt；含手动输入/单实例/首启居中/F 图标；交付前旧文件清空、使用数据备份于 `E:\译雀1.0-数据备份\`）；源码包不含密钥 |

## 3. 技术栈与运行环境

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2（Rust，edition 2024） |
| 前端 | 原生 TypeScript + Vite 8，无框架、无 UI 库、无第三方运行时 JS 依赖 |
| 渲染引擎 | WebView2（Windows 10/11 一般自带 Runtime） |
| HTTP | Rust `reqwest 0.12`（关默认特性，只开 `native-tls`），全局复用一个 Client |
| 配置 | `config.local.json`，由 Rust 读写，原子替换 |
| 服务端 | 腾讯 TokenHub，`/v1/chat/completions`，OpenAI Chat Completions 协议 |

**开发环境前置**：Node.js（含 npm）、Rust 工具链、MSVC / Visual Studio Build Tools（Windows 链接器）、Tauri CLI（随 `npm install` 的 `@tauri-apps/cli` 提供）、WebView2 Runtime。

---

## 4. 软件架构

### 4.1 分层

| 层 | 文件 | 职责 |
|---|---|---|
| 表现层（WebView） | `index.html`、`src/styles.css`、`src/main.ts`(1523 行) | 状态机、方向判定、单词分流、全部渲染、设置/主题/字号/中英文界面、历史/生词本、事件绑定 |
| 适配层（也在 WebView） | `src/adapters/hy.ts`(91 行)、`word.ts`(227 行)、`types.ts`、`index.ts` | 句子 POST 构造与响应处理、单词判定/释义归一化/兜底请求体与校验、按模型取超时 |
| 配置与 IPC 封装 | `src/config.ts`、`src/http.ts` | 读配置、白名单保存、`http_request` 调用 |
| 系统层（Rust） | `src-tauri/src/lib.rs`、`http.rs`、`config.rs`、`dict.rs`、`store.rs`、`system.rs` | 剪贴板轮询、托盘、窗口与位置记忆、HTTP 转发、配置落盘、词典查询/AI 缓存、历史/生词本/导出、全局热键/开机自启 |
| 外部服务 | TokenHub | 单次 POST，一次性返回完整译文 |

**关键设计**：网页层负责业务和画面，Rust 层负责系统能力；连 HTTP 请求也要从网页经 IPC 交回 Rust 发出（统一连接池、绕开浏览器跨域）。

### 4.2 一次翻译的数据链路

1. Rust 每 **220ms** 读一次 `GetClipboardSequenceNumber()`；序号变化才读剪贴板文本，空白内容跳过，自写入内容用 suppression slot 抑制。
2. Rust `emit("clipboard-changed", {text})` → 网页监听入口**统一 `trim()`**。
3. 网页 `handleClipboard()`：100ms 合流（`MERGE_MS`）、1 秒内同文本去重（`DUP_WINDOW_MS`）。
4. `runTranslation()`：自动判向（汉字占比 > 30% → 中→英，否则英→中）→ 超 `maxChars` 本地跳过并给「仍要翻译」出口 → loading 态。**竞态防护**：每次领递增 `requestSeq`，句子/单词异步返回后编号≠最新即丢弃（不渲染/不写历史）。
5. **单词分流**：英→中且为单个英文单词（`WORD_RE`，纯字母允许词内撇号/连字符，≤40 字符）→ 走词典卡流程（`dict_lookup`：词典精确→小写→inflections 反查原形→AI 缓存→AI `json_object` 兜底固定 deepseek→校验通过 `dict_cache_put` 写缓存；任一环节不可用静默降级为句子翻译）。否则继续句子 POST。
6. `buildPayload()` 生成请求体 → `httpRequest()` → Rust `http_request` → `reqwest` POST。
7. 响应回传网页：`choices[0].message.content` **只做 `trim()`** → `renderText()` 写入 `#targetBody`；句子/单词成功均写历史（`history_add`）。
8. 底栏显示 `由 {模型名} 翻译`（词典卡为「由本地词典提供」或「由 deepseek-v4.1-flash-1017 详解」）；复制按钮复制当前译文/释义行。

**手动输入（第二入口，与剪贴板并存、无互斥）**：原文框 `#sourceText` 是 `textarea`；`Enter` 或「翻译」按钮 → `triggerManual()` 取 `value.trim()` 调**同一个** `runTranslation()`；`Shift+Enter` 换行、输入法组词（`isComposing`）的 Enter 忽略、空白忽略。原文框内容由调用方填充（`handleClipboard` 合流回调 / 手动输入 / 历史回看），`runTranslation()` 本身**不再改写原文框**（避免覆盖用户草稿），也**不再做 140 字符截断**。聚焦原文框时剪贴板仍照常自动翻译并覆盖草稿——无模式开关、无焦点抑制。

### 4.3 Rust 侧 30 个 IPC 命令

- **窗口与剪贴板（10）**：`start_clipboard_watch` / `stop_clipboard_watch` / `set_paused` / `set_clipboard_text` / `read_clipboard_now` / `hide_window` / `minimize_window` / `show_window` / `set_always_on_top` / `resize_view`
- **HTTP（1）**：`http_request`
- **词典（3，`dict.rs`）**：`dict_lookup` / `dict_cache_put` / `dict_status`
- **历史/生词本/缓存（9，`store.rs`）**：`history_add` / `history_list` / `history_clear` / `favorite_put` / `favorite_remove` / `favorite_list` / `favorites_export` / `cache_stats` / `cache_clear`
- **系统能力（4，`system.rs`）**：`hotkey_set` / `hotkey_available` / `autostart_get` / `autostart_set`
- **配置（3，`config.rs`）**：`read_config` / `config_location` / `save_settings`

窗口权限在 `src-tauri/capabilities/default.json`；最小化走 Rust 命令而非前端窗口 API，因为 capabilities 没有 `allow-minimize`。全局热键用 Win32 `RegisterHotKey(NULL,1,MOD_CONTROL|MOD_ALT,VK_T)` + 独立线程 `GetMessageW` 收 `WM_HOTKEY`；开机自启写 HKCU Run 注册表（值名 `YiJianClipboardTranslator`，注册表为唯一事实源，默认无值=关）。

---

## 5. 目录与文件职责

```
clipboard-translator/
├─ PROJECT_HANDOFF.md          本交接文档
├─ README.md                   项目说明（架构 / POST / 配置 / 验证 / 已知边界）
├─ TEST_REPORT.md              完整测试报告（含 18 用例输入输出、超时实测）
├─ index.html                  窗口 DOM 骨架、工具条、设置页、底栏
├─ package.json / package-lock.json
├─ tsconfig.json / vite.config.ts（固定 1420 端口、忽略 src-tauri 热更新）
├─ config.local.example.json   ★ 无密钥配置模板
├─ preview.html                静态视觉基准（平行实现，改 UI 需手工同步）
├─ preview-morandi.html        用户创建的另一份视觉稿（git 未跟踪）
├─ .gitignore / .vscode/extensions.json
├─ src/
│  ├─ main.ts                   ★ 全部 UI 状态与渲染（1523 行，含历史/生词本/系统能力 UI）
│  ├─ styles.css                ★ 全部样式（含主题色、字号变量、圆角、库行/折叠组/星标）
│  ├─ config.ts                 配置类型、四模型清单、分档超时、DEFAULT_MODEL、loadConfig/saveSettings
│  ├─ http.ts                   invoke("http_request") 封装
│  └─ adapters/
│     ├─ hy.ts                  ★ 句子 POST 构造 + 响应处理（91 行，改动前必读）
│     ├─ word.ts                ★ 单词判定 / 释义归一化 / 兜底请求体与 JSON 校验（227 行）
│     ├─ types.ts               TranslateRequest / TranslateResult / Translator / WordCard
│     └─ index.ts                buildTranslators：按模型取超时
├─ src-tauri/
│  ├─ Cargo.toml / Cargo.lock / build.rs / tauri.conf.json
│  ├─ capabilities/default.json / gen/schemas/*.json / icons/*
│  ├─ examples/prepare_dict.rs  官方 ECDICT → 精简词库 + inflections 变形表
│  └─ src/ lib.rs · http.rs · config.rs · dict.rs · store.rs · system.rs · main.rs
└─ tests/
   ├─ payload.test.mjs          请求体回归（离线，15 项）
   ├─ word.test.mjs             单词详解回归（离线，25 项）
   ├─ timeout.test.mjs          分档超时回归（离线，13 项）
   ├─ live.mjs                  四模型 × 3 类输入真实 API 实测（12 次，需联网）
   ├─ timeout-live.mjs          1950 字符长段落四模型耗时实测（需联网）
   ├─ e2e.mjs                   真实窗口 CDP 端到端（21 场景，需调试端口）
   ├─ manual-e2e.mjs            手动输入真实窗口端到端（M0–M8 共 10 项，需调试端口；截图存 shots-manual/）
   ├─ race-e2e.mjs              竞态防护真实窗口端到端（R1–R3 共 4 项，需调试端口；截图存 shots-race/）
   ├─ verify-d.mjs              体验优化可视化 + 功能验证（CDP 截图，跑完自恢复）
   ├─ release-smoke.mjs         发布版冒烟（4 场景）
   ├─ *-results.json            实测原始数据（不含密钥）
   └─ shots/d-*.png             体验优化轮界面截图留档（10 张）
```

**运行期生成（配置同目录，不入库、不含密钥）**：`library.db`（历史 cap 100 + 生词本）、`word_cache.db`（单词 AI 详解缓存）、`window-state.json`（窗口位置/大小记忆）、只读 `ecdict.db`（由 `dictPath` 指向，词库与软件分离存放）。

**包里刻意不含**：`config.local.json`（含真实 API Key）、`node_modules/`、`src-tauri/target/`（6.4 GB 构建缓存）、`dist/`、`.git/`、`*.tmp`。git 历史以 `git-history.bundle` 单独提供（见第 12 节）。

---

## 6. 快速开始（Qoder 首次接手）

```bash
# 1) 依赖
npm install

# 2) 配置：复制模板为 config.local.json，填入自己的 API Key
cp config.local.example.json config.local.json
#    必填 engines[0].apiKey；baseUrl 默认 https://tokenhub.tencentmaas.com/v1

# 3) 开发模式（Vite 1420 + Tauri 窗口）
npm run tauri dev

# 4) 类型检查 / 前端构建 / Rust 检查
npx tsc --noEmit
npx vite build
cargo check --manifest-path src-tauri/Cargo.toml

# 5) 正式构建（前端 + Rust release + NSIS 安装包）
npx tauri build
#    产物：src-tauri/target/release/clipboard-translator.exe
#          src-tauri/target/release/bundle/nsis/译笺_0.1.0_x64-setup.exe
```

打包版首次运行会在 **exe 所在目录**查找 `config.local.json`；找不到时可在设置页填 Key，程序自动创建。

> 配置查找顺序：`config.rs::candidates()` —— 当前工作目录、其父目录、exe 目录及其最多 5 级父目录。改配置路径逻辑前先读这个函数。

---

## 7. 配置说明

`config.local.json` 示例（**密钥只放这里，已被 `.gitignore` 排除，绝不入库或写进报告**）：

```json
{
  "defaultEngineId": "hy",
  "timeoutMs": 15000,
  "maxChars": 2000,
  "engines": [
    {
      "id": "hy",
      "displayName": "混元翻译",
      "apiKey": "在这里填 API Key",
      "baseUrl": "https://tokenhub.tencentmaas.com/v1",
      "model": "hy-mt2-pro"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `engines[0].apiKey` / `baseUrl` / `model` | 必填；`validateEngine()` 校验空值/占位符/URL 格式 |
| `maxChars` | 原文长度上限，200–2000，默认 **2000**；超限本地跳过、一个请求都不发 |
| `timeoutMs` | **只对未登记模型兜底**；四个已知模型实际用 `MODEL_TIMEOUT_MS` 分档（mt2 12s / deepseek 30s） |

写入由 Rust `save_settings` 完成：**白名单合并**（`ENGINE_KEYS` / `ROOT_KEYS`），前端传来的其他字段一律忽略；先写 `.tmp` 再原子 rename，错误信息不含密钥。设置页所有输入实时保存（500ms 防抖），Key 输入框用掩码显示。

---

## 8. POST 请求（核心，改动前必读）

### 8.1 请求体（五个字段，逐字审核过）

```json
{
  "model": "hy-mt2-pro",
  "messages": [
    {
      "role": "user",
      "content": "Translate the following text into Chinese. Note that you should only output the translated result without any additional explanation:\n\nThe committee has reached a consensus on the annual budget."
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 4096
}
```

- `content` 末尾那句英文是 **`{source_text}` 占位符示例**，运行时由剪贴板内容整段替换，`\n\n` 是官方模板原文里指令与待译文本的分隔；中文输入时 `Chinese` 换成 `English`。模板为 hy-mt2 官方 **Default Translation** 原文。
- **单条 user、无 system**：官方说明「模型没有默认 system_prompt」。
- **不传** `response_format`（平台默认纯文本）、`top_p`（官方说与 temperature 二选一，默认 1.0 即 pro 推荐值）、`repetition_penalty` / `top_k`（官方列为会被静默忽略）、`stop` / `seed`。
- **句子与段落走这条**。**英→中单个英文单词不走这条**，改走词典卡流程（见 8.1b）；中→英单个词、或词典/AI 兜底失败降级时，才回到这条句子 POST。

### 8.1b 单词详解兜底请求体（独立于句子，逐字审核过）

英→中单个英文单词且本地词典未命中时，由 `src/adapters/word.ts::buildWordPayload` 构造，**固定模型 `deepseek-v4.1-flash-1017`**（hy-mt2 系列不支持结构化输出，故不可选），凭证复用当前引擎 `apiKey`/`baseUrl`：

```json
{
  "model": "deepseek-v4.1-flash-1017",
  "messages": [{ "role": "user", "content": "你是英汉词典。请为英文单词「X」输出一个 JSON 对象，字段如下：\n{\"word\":...,\"phonetic\":...,\"senses\":[{\"pos\":...,\"def\":...}],\"example\":...,\"example_cn\":...}\n要求：senses 覆盖该单词全部常用词性和释义，按常用程度排序；只输出 JSON 本身，不要 markdown 代码块，不要任何其他文字。" }],
  "stream": false,
  "temperature": 0,
  "max_tokens": 2048,
  "response_format": { "type": "json_object" }
}
```

`json_object` 只保证合法 JSON，客户端仍做形状校验，失败重试 1 次；再失败静默降级为句子翻译。校验通过写 `word_cache.db`，下次秒出。

### 8.2 六引擎参数

> **2026-11-11 更新：本节表格为历史快照。** `hy4` / `glm-5.3-flash` 已下架，当前句子模型只有 `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` / `deepseek-v4.1-flash-1017` 四个（**初次默认 `hy-mt2-pro`**），hy4 的 `thinking` 特殊分支已删除。设置页只有「长文本翻译模型」一个选择器；**单词详解 AI 兜底固定 `deepseek-v4.1-flash-1017`**（hy-mt2 系列不支持结构化输出），`wordModel` 配置键与选择器已删除，`config.rs::ROOT_KEYS` 现为 `["timeoutMs","maxChars","dictPath"]`。单词详解开关已移除（常开），`dictEnabled` / `relatedEnabled` 字段与旧配置归一化逻辑一并删除，不做旧配置兼容。长度上限 clamp 200–2000。当前口径以 `README.md` 与 `TEST_REPORT.md` 第十三、十四、十五、十六节为准。

| 模型（API 参数） | temperature | 超时 | `max_tokens` | 备注 |
|---|---:|---:|---:|---|
| `hy-mt2-pro` | 0.7 | 12s | 4096 | 翻译专用，初次默认 |
| `hy-mt2-plus` | 0.7 | 12s | 4096 | 翻译专用 |
| `hy-mt2-lite` | 0.7 | 12s | 4096 | 翻译专用 |
| `hy4` | 0.3 | 30s | **2048** | **额外传 `thinking:{"type":"disabled"}`** |
| `glm-5.3-flash` | 0.3 | **90s** | 4096 | 推理模型，长段落波动 15.8–52.2s |
| `deepseek-v4.1-flash-1017` | 0.3 | 30s | 4096 | 推理模型 |

四个通用/推理模型需在 TokenHub 控制台先**激活**，否则返回 402。`glm-5.3-flash` / `deepseek-v4.1-flash-1017` 默认会先产生 `reasoning_content`（不污染译文，但按输出 token 计费）。

**hy4 特例的来龙去脉（勿轻易回退）**：1950 字符长段落下，hy4 曾把 4096 个输出 token 全花在推理链上、译文 0 字符。实测五组参数——`max_tokens` 放大到 8192（79.5s 仍失败）、`stop` 序列（推理阶段被截断、无译文）、`reasoning_effort: low`（无效）——**只有 `thinking: {"type":"disabled"}` 有效**：约 5 秒、正常结束、译文完整、零推理，正常输出约 339 token，故把上限收到 2048 留 6 倍余量。其余五个模型请求体逐字不动。

### 8.3 响应处理

- 只取 `choices[0].message.content` 并 `trim()`，**不做**引号剥离、前缀清洗或任何结构化解析。
- `finish_reason === "length"` → 抛错显示错误态（纯译文被截断无法救回）。
- 服务端 `error` / 非 2xx：**原文照显**，不做中文映射。
- HTTP 超时在 Rust `http.rs`：`timeout_ms` 被 `clamp(1000, 120_000)`；分档表在 `src/config.ts::MODEL_TIMEOUT_MS`，用 `satisfies` 保证新增模型必须补档，改 90 秒时**同步检查 clamp 上限**。

### 8.4 参数分档的实测依据（2026-11-11，1950 字符段落）

hy-mt2 2.7 / 3.4 / 1.2 秒；hy4 4.9 秒（关闭思考后）；deepseek 14.4 秒；glm 15.8 秒（历史峰值 52.2 秒）。全部 6/6 正常结束、译文完整；真实窗口 CDP 4/4 通过。详细输入输出见 `TEST_REPORT.md` 第十节。

---

## 9. 界面现状

- 窗口 360×560，透明无边框圆角，`decorations:false` / `transparent:true` / `shadow:false` + Rust `set_background_color(Color(0,0,0,0))`；**改 `tauri.conf.json` 必须完整重启 dev server**（窗口属性创建时确定，热重载不重建窗口）。
- **首启居中**：conf `center:true`；`restore_window_state` 无存档时 `window.center()`（任务栏感知的工作区中心），有存档仍恢复记忆位置。
- **单实例仅发布版**：`tauri-plugin-single-instance` 以 `#[cfg(not(debug_assertions))]` 注册；release 二次启动转发到已有实例并退出、唤出/聚焦主窗；dev/debug 不注册可多开。实测 release 双开=1 进程、debug 双开=2 进程。
- **图标已落地（F 圆雀·浅色）**：源 `prototypes/icon-f-light.svg`/`icon-f-light-1024.png` → `tauri icon` 全格式替换 `src-tauri/icons`（exe/窗口/托盘共用 `default_window_icon`）；已删仅移动端用的 `ios/`/`android/` 子目录。候选原型留 `prototypes/icon-studio.html`。**坑**：`tauri_build` build script 的 rerun-if-changed 只含 `capabilities`/`tauri.conf.json`，不跟踪 icons——只换图标 exe 会内嵌旧图标；换图标后须 `touch src-tauri/tauri.conf.json` 再 build。验证用 `Icon.ExtractAssociatedIcon(exe)`（System.Drawing 解 PNG 压缩的 256 帧会花屏，不可信）。
- 顶部工具条从左到右：「译雀 / Sparrow」（随界面语言中英切换，`document.title` 同步）→ 监听开关 → 置顶 → 切换方向 → **历史与生词本（书本）** → 设置 → **最小化（横线，X 左边）** → 收进托盘（X）。X 是 `hide()` 隐藏到托盘，不是退出；真正退出在托盘菜单。
- 译文区：句子是一段纯译文；**英→中单个英文单词显示词典卡**（原形提示→词头+音标→柯林斯/牛津/考纲 chips→按词性分组释义→例句，右上角星标收藏）。状态有首屏 / 加载（模型名+已用秒数，单词额外标注 deepseek 通常需数秒）/ 跳过 / 错误（服务端原文 + 提示文字，**无跳转按钮**，带重试）/ 译文，共用一个 `#targetBody`，每次清空重建。
- 底栏：句子 `由 {模型名} 翻译`；词典卡 `由本地词典提供` 或 `由 deepseek-v4.1-flash-1017 详解`。
- 设置页：连接组（API Key 掩码+显隐、接口地址、**长文本翻译模型四选一**）；行为组（剪贴板监听、长度上限 200–2000、词典路径+词典状态、**单词缓存统计+清空**、**全局热键开关 Ctrl+Alt+T**、**开机自启开关默认关**）；外观组（界面语言、字号、**配色方案 8 选 1 默认雾隐**、窗口置顶）**常开不折叠**。「单词详解」常开无开关、「相关词条」占位行已删。
- **历史 / 生词本页**同窗切换（书本按钮进入）：历史/生词本两标签 + 清空；历史行点按回看、行内复制；生词本行点按回显词典卡、可删除，标签下方「导出 CSV / 导出 Anki」按钮。
- 原文在 `clipboard-changed` 入口统一 `trim()`；显示、去重、长度判断、POST 拼接全用同一干净值。
- 悬浮提示 `data-tip` 靠 mouseenter/focus 显示，窗口 `blur` / `focus` / `visibilitychange` + 点击最小化时主动隐藏——**窗口最小化不触发 mouseleave/blur**，这条是修过的坑。

---

## 10. 测试体系

| 命令 | 作用 | 前置 |
|---|---|---|
| `node tests/payload.test.mjs` | 请求体逐字回归 **15/15** | 离线 |
| `node tests/word.test.mjs` | 单词详解回归 **25/25**（判定/兜底请求体/归一化/JSON 校验） | 离线 |
| `node tests/timeout.test.mjs` | 分档超时回归 **13/13** | 离线 |
| `node tests/live.mjs` | 四模型 × 3 类输入，12 次真实请求 | 联网 + `config.local.json` |
| `node tests/timeout-live.mjs` | 1950 字符长段落四模型耗时 | 联网 + `config.local.json` |
| `node tests/e2e.mjs` | 真实窗口 **21 场景**（CDP 读写 DOM/剪贴板） | 带调试端口启动窗口 |
| `node tests/manual-e2e.mjs` | 手动输入 **10 项**（textarea/Enter/Shift+Enter/空白/IME/聚焦复制/超限/历史） | 带调试端口启动窗口 |
| `node tests/race-e2e.mjs` | 竞态防护 **4 项**（慢先快后丢弃迟到响应/不写历史/快先慢后最新获胜） | 带调试端口启动窗口 |
| `node tests/verify-d.mjs` | 体验优化可视化 + 功能验证（截图 `tests/shots/d-*.png`，跑完自恢复） | 带调试端口启动窗口 |
| `node tests/release-smoke.mjs` | 发布版冒烟 4 场景 | 带调试端口启动发布版 exe |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust 单测 **8 passed / 1 ignored**（联网探针需密钥） | 无需真实密钥 |

```bash
# 端到端需要先这样启动窗口：
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
```

**注意事项**

- 所有 `tests/*.mjs` 都靠 `npx esbuild` 把 TS 临时打包成 `.mjs` 再导入；esbuild 是 Vite 的**传递依赖**，未在 `package.json` 显式声明。若换环境后报找不到 esbuild，补 `npm i -D esbuild` 即可。
- 测试会生成 `.tmp-*.mjs` 临时 bundle（已被清理；重跑会再生成，勿提交）。
- `tests/e2e.mjs` 会切换模型做验证，**跑完还原测试开始时的模型**并有 E9 断言保证配置未被改动。
- 结果文件 `tests/*-results.json` 与截图已入库，均不含密钥。
- `preview.html` 的内联 JS 改动后要校验语法（提取 `<script>` 内容 `node --check`）。

---

## 11. 已知边界与踩坑清单

> 注：第 1–4 条为历史快照（本地词典现已实现、`glm` / `hy4` 已下架、`maxChars` 现 clamp 200–2000）；当前口径见 README 与 TEST_REPORT 第十五节。

1. **本地词典未实现**：查单词只给一句译义。设置页两项「功能未实现」是占位，不是死开关。
2. **glm 长段落耗时波动极大**（15.8–52.2 秒），90 秒按峰值留 1.7 倍余量；当时手动把 `maxChars` 调到 5000 仍可能超时（现上限已 clamp 到 2000）。
3. **hy4 依赖平台继续支持 `thinking: disabled`**；若被忽略，2048 上限会让它较快失败报错，不会长时间空转。
4. **glm/ds4 是推理模型**，输出 token 明显高于翻译专用模型；`reasoning_content` 单独字段，不污染译文但计费。
5. **多实例冲突**：同一 WebView2 用户数据目录不能同时开两个译笺（打包版 + dev），第二个会报 `0x8007139F`。解决：设 `WEBVIEW2_USER_DATA_FOLDER` 指向独立临时目录；dev 固定 1420 端口，启动前确认端口空闲。
6. **首次 release 构建可能卡死**：这台机器上出现过两个 MSVC `link.exe` 在 build script 链接阶段 CPU≈0、20 分钟无输出。处理：终止构建进程、删除 `src-tauri/target/release/build/<卡住的包>-*` 两个缓存目录后重试（已编译依赖会复用，约 3 分钟完成）。dev 编译偶发的增量锁「拒绝访问」同源。
7. **原文 trim 只发生在网页入口**，Rust 侧 `trim().is_empty()` 只是空白判断、不改值。
8. **剪贴板是 220ms 轮询**，不是事件式监听，最多约 220ms 延迟。
9. **打包版改代码后必须完全退出旧进程再重开**：磁盘 exe 更新了，内存里仍是旧逻辑；收进托盘不算退出。
10. **窗口圆角**需三处同时到位（见第 9 节），Win10 19045 实测有效；若失效，备选 Win32 `CreateRoundRectRgn` + `SetWindowRgn`。
11. **界面语言有中/英两套**，译文目标语由自动判向决定，不是固定中文。
12. 未做：LRU 缓存淘汰、划词/截图 OCR、Rust 原生窗口重写、相关词条（同义/反义联想）。**全局热键、窗口位置/大小记忆、翻译历史、生词本、开机自启均已实现**（第 16 节）。
13. **历史 cap 100**：`library.db` 只存最近 100 条翻译，超出淘汰最旧；生词本收藏无上限。`cache_clear` 后 `word_cache.db` 的 `bytes` 不缩（SQLite 不自动 VACUUM），但 `count=0`，统计以条数为准。
14. **全局热键被占用**：`RegisterHotKey` 失败时 `hotkey_available` 返回 false，前端开关自动禁用并提示「已被其他程序占用」，不崩溃。
15. **开机自启以注册表为唯一事实源**：`autostart_get` 读 HKCU Run 值是否存在，默认无值=关；前端 localStorage 不缓存自启态，避免与注册表不一致。

---

## 12. git 历史

`main` 分支 10 个提交，最新 `3fadcb4`：

| 提交 | 内容 |
|---|---|
| `8d9702c` | 初始提交（当时的 json_schema 词条卡版本，仅供历史追溯） |
| `e976bc0` | 重做词典卡展示层，补展示模型 |
| `d9d1430` | 按四层信息架构重做词典卡 |
| `ca02f9c` | 三种译文框架 + 官方模板 POST + 完整测试报告 |
| `c82ee24` | **重构：六引擎句子翻译，单词也按句子模式**（当前方案的起点） |
| `c28a12f` | README 对齐当前方案 |
| `054a089` | 新增最小化按钮 |
| `bc38944` | 原文 trim、最小化图标居中与提示残留修复 |
| `2052869` | 按模型分档超时 |
| `3fadcb4` | 2000 字符标准重校准超时、hy4 关闭思考 + 输出上限 2048 |
| （其后一个纯文档提交） | 新增 `PROJECT_HANDOFF.md`、校正 README 的测试项数与 `max_tokens` 说明，无功能改动 |

源码包内附 `git-history.bundle`（纯提交对象，不含本地路径与仓库配置）。在 Qoder 中恢复历史：

```bash
git clone git-history.bundle clipboard-translator-history
# 或：把 bundle 当作 remote 拉取
git init && git remote add history ./git-history.bundle && git fetch history
```

---

## 13. 后续开发计划（用户已明确的意图）

### 13.1 第二步：本地词典翻译单词（✅ 已实现）

**现状**：已落地为「本地 ECDICT（SQLite）优先 + AI `json_object` 兜底（固定 deepseek）+ 缓存」，详见 README「单词详解」与 TEST_REPORT 第十一·十五·十六节。下列为当初调研的一手事实，保留作背景参考：

- 数据源 `ECDICT`（skywind3000，开源英汉词典，**MIT 许可**，主 CSV 约 62.95 MB、76 万词条）；官方 `ecdict.mini.csv` 实际只有 4204 字节（近乎空文件），网上「精简版约 10MB」的说法不成立，要轻必须**自己按词频裁剪 2–3 万常用词**。
- 字段：`phonetic`（只有一份英式音标，无 UK/US 双份）、`translation`（每行一条中文释义，词性前缀不统一：`n.` / `vt.` / `a.` / `[医]` / 无前缀，需要一层确定性归一化才能按词性分组）、`exchange`（`0:` 是 Lemma 原形）、`lemma.en.txt`（约 2.21 MB，官方称覆盖 BNC 全部变形、95% 可查）。
- 推荐组合：**编译期静态表 / 紧凑二进制 + Rust 侧查表**（不占 WebView 内存、零网络、零 token、毫秒级），未命中退回现有句子 POST。
- **POST 层不用再动**：只需在「剪贴板事件 → 分流」处加判断（是单词且词典命中 → 出卡；否则 → 走现有 POST）。这是当初把请求层收敛成单一模式的原因。
- 许可义务：MIT，分发物保留版权与许可声明即可。若改用 Wiktionary，需处理 CC BY-SA 的衍生作品同许可问题。
- 词典命中时模型未参与，底栏「由 xxx 翻译」的文案是否调整，属于界面文案，需用户点头再改。

### 13.2 UI 定稿后：Rust 原生窗口重写表现层

用户明确要求记住并主动提醒：**UI 最终定稿后，用 Rust 原生窗口库（egui / native-windows-gui / Win32 自绘，未定）重写整个 UI 层，替换 WebView2**。动机是当前架构内存偏高（实测 7 进程工作集合计约 400MB），与「极致轻量化」不符；原生单进程预计 10–20MB。范围只换表现层，翻译链路、剪贴板监听、托盘、配置读取、适配器签名可保留。代价：字号滑块、独立滚动、悬浮提示、四角圆角、双语切换等都要自己实现。**触发条件：用户宣布「UI 定稿 / UI 不再改了」时主动提醒，不要提前动手。** 视觉基准是 `preview.html`。

### 13.3 其他已讨论但未拍板

- 通用推理模型默认开思考带来的成本差异（deepseek 是推理模型，输出 token 偏高；hy-mt2 三个无推理链）。
- LRU 缓存淘汰（历史已 cap 100，单词缓存目前只增不淘汰，可手动清空）。
- 划词翻译 / 截图 OCR（远期，未拍板）。
- **已明确不做**（用户 2026-11-11 点单）：错误态跳转按钮（只给提示文字）、限流/超时自动换模型重试、小项（复制原文按钮 / 合并背景与多巴胺）。

---

## 14. 协作约定（务必遵守）

1. **没交代的不要擅自改**：提示词、界面文案、默认值、成本相关参数（`max_tokens` / 超时 / 长度上限 / 示例条数）等会影响模型行为或用户可见效果的改动，必须先给方案、等明确点头；bug 修复与容错可直接做，但要如实汇报。
2. **请求体是用户逐字审核过的**：实测发现模型问题也先给数据，不擅自加字段或改模板。历史上因擅自压缩提示词、擅自加 HTTP 429 中文映射被明确点名。
3. **「停一下 / 先给方案」= 只分析和出方案，不写文件、不跑实验性命令**；理解对了不等于被授权。
4. **验证要真**：涉及 UI 的交付必须自己看真实窗口截图 / CDP DOM，不能只靠单测或断言数量宣布完成；历史上多次因为只验「有没有」不验「冗余不冗余」「恢复之后的状态」而漏掉内容逻辑 bug。
5. **密钥红线**：`config.local.json` 含真实 API Key，绝不入库、不写进报告、不复制进任何交付包；结果文件交付前 grep 确认。
6. 术语首次出现要讲人话（用户是新手视角），解释要说清「为什么这样算」。

---

## 15. Qoder 接手检查清单

- [ ] 解压源码包，确认 `config.local.example.json` 存在、`config.local.json` **不存在**（自己填 Key）
- [ ] `npm install` → `npx tsc --noEmit` → `npx vite build` 全过
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过（确认 MSVC 工具链可用）
- [ ] `npm run tauri dev` 起窗口，复制一句英文验证出中文译文
- [ ] `node tests/payload.test.mjs`（15/15）、`node tests/word.test.mjs`（25/25）、`node tests/timeout.test.mjs`（13/13）
- [ ] 需要联网验证时再跑 `live.mjs` / `timeout-live.mjs`（会消耗 token）
- [ ] 需要 UI 验证时按第 10 节带 CDP 端口启动，跑 `tests/e2e.mjs`（21 场景）与 `tests/verify-d.mjs`（截图自恢复）
- [ ] 想看历史：用 `git-history.bundle` 克隆；想看实测数据：读 `TEST_REPORT.md`（第十五·十六节为当前基线）
- [ ] 开始新改动前，先读第 8 节与第 14 节

---

## 16. 体验优化轮（2026-11-11）当前基线增量

本节是冷读者了解「现在到底多了什么」的权威增量清单。需求由用户点单：「6、小项这部分先不做；2、错误态给提示即可。限流/超时自动换模型重试这个不做。开机自启动可以放在设置页，默认值是关闭。其他按你说的改。」

### 16.1 新增能力（10 项，全部已实现并真窗口验证）

| # | 能力 | 落点 | 关键事实 |
|---|---|---|---|
| 1 | 加载进度感 | `main.ts` `renderLoading` | 显示模型名 + 每秒更新的已用秒数；单词详解额外标注「deepseek 通常需数秒」 |
| 2 | 错误态提示 | `main.ts` i18n `errorSub` | 服务端原文 + 「检查 API Key 与接口地址；402 多为模型未启用，限流或超时可稍后重试」，**仅文字、无跳转按钮** |
| 3 | 设置页布局 | `index.html` | 删「相关词条」占位行；外观组改 `<details>` **默认折叠** |
| 4 | 窗口记忆 | `lib.rs` + `window-state.json` | 逻辑像素 x/y/w/h，`Moved/Resized`→500ms 防抖落盘，启动校验范围后恢复；**无存档首启 `center()` 居中**（conf `center:true`） |
| 5 | 原形 chip 统一 | `dict.rs` | 词典直接命中也返回 `lemma`（`Option`→`null`），与反查/AI 路径一致 |
| 6 | 翻译历史 | `store.rs` + `library.db` | cap 100，超出淘汰最旧；点行回看、行内复制、一键清空 |
| 7 | 全局热键 | `system.rs` | `Ctrl+Alt+T` 唤出/隐藏，设置页开关（localStorage `wb_hotkey` 默认开）；被占用自动禁用并提示 |
| 8 | 缓存管理 | `store.rs` `cache_stats/clear` | 设置页显示「N 条 · X KB」，一键清空（清空后 bytes 不缩、count=0） |
| 9 | 生词本 | `store.rs` + `library.db` | 词典卡右上角星标收藏；导出 CSV / Anki（制表符分隔）到配置同目录 `生词本.csv` / `生词本-anki.txt` |
| 10 | 开机自启 | `system.rs` | 设置页开关，**默认关**，HKCU Run 注册表为唯一事实源 |

### 16.2 新增文件与运行期产物

- 源码：`src-tauri/src/store.rs`(264 行)、`src-tauri/src/system.rs`(211 行)；`src/adapters/word.ts`(227 行，单词详解轮已建)；`tests/verify-d.mjs`。
- 运行期（配置同目录，不入库、不含密钥）：`library.db`（history + favorites 两表）、`window-state.json`。`word_cache.db` 为单词详解轮产物。
- IPC 由 14 → **30**（+3 dict +9 store +4 system），见第 4.3 节。

### 16.3 验证（全部真窗口/真重启，非仅断言数量）

- 离线：payload 15/15、word 25/25、timeout 13/13、Rust 8 passed/1 ignored；tsc 0 错、vite build 通过。
- **e2e 21/21**（CDP 9222）：E4 相关词条行=false/外观折叠=true/自启=false；W4 `befallen`→原形行 `befall`；L1 历史 10 行；L4 缓存「2 条 · 12.0 KB」/热键 Ctrl+Alt+T 可用/自启 false；L3、L5 星标与热键切换自恢复；E9 配置 model/maxChars 未被改动。
- **verify-d**：坏 baseUrl 触发错误态（提示正确、无按钮）→还原；apple 星标 off/on；生词本导出 CSV/Anki 内容校验后删测试文件；新词 `zorpquake` 抓加载帧；缓存 3→0→2 还原；favorites 归 0。
- **窗口记忆真重启**：缩放 430×540→落盘 `{w:430,h:540,x:2184,y:832}`→重启→`GetWindowRect` 物理矩形 2184,832,2614,1372（W=430 H=540）一致→健康探针 hotkey=true/autostart=false/cache=2→重置 360×560。
- 截图 10 张 `tests/shots/d-*.png` 均已亲眼确认（用户主题古墨绿 #254B3B 深色）。

### 16.4 接手注意

- **不要复活旧方案**：json_schema 词条卡、`B|`/`S|` 行格式、word-lean、六引擎、单词模型可选、单词详解开关、相关词条占位——均已删除或下线。
- **请求体红线**：句子 POST 五字段、单词兜底 `json_object` 请求体均经用户逐字审核，不擅自加字段/改模板（第 8、14 节）。
- **自启/热键有系统副作用**：测试只切 localStorage 与运行态并自恢复，不写注册表、不真注册占用热键；改这两块要真机验证。
- **本轮不打包发布**（用户延续指示）；dev 窗口留给用户，配置/缓存/收藏/窗口尺寸均已还原到交付前状态。
