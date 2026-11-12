# 译雀 · 剪贴板翻译工具

复制即翻译的极简桌面浮窗。**Tauri 2**（用 Rust 写系统外壳、用网页技术写界面的桌面应用框架）+ Rust 外壳 + Vanilla TypeScript，无第三方前端库、无流式输出。

> 本文档对应 2026-11-11 模型精简 + 单词模型固定落地后的版本：句子翻译只保留四个模型（下架 `hy4` / `glm-5.3-flash`，初次默认 `hy-mt2-pro`），单词详解的 AI 兜底**固定** `deepseek-v4.1-flash-1017`（hy-mt2 系列不支持结构化输出，不做可选），详解功能常开、设置页无开关；长度上限 200–2000、默认 2000。上一版（`json_schema` 词条卡、单词/句子双模式、相关词条开关、单词模型可选）已整体推翻，本文档只描述当前方案。
>
> **迁移交接**：转交给其他开发工具/开发者时，另见 `PROJECT_HANDOFF.md`（含完整架构、环境、坑、后续计划与检查清单）。

---

## 当前状态

**已实现**

- 大模型翻译句子与段落；四个翻译模型可在设置页切换，共用同一套请求：
  `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` / `deepseek-v4.1-flash-1017`。
- **单词详解**：复制单个英文单词（英→中方向）时出词典卡——本地 ECDICT 词典优先（音标、词性分组释义、柯林斯/牛津/考纲标记），未收录时由 AI JSON 模式兜底并写入本地缓存，下次秒出。兜底模型**固定** `deepseek-v4.1-flash-1017`（hy-mt2 系列不支持结构化输出），设置页不提供改选。
- 自动判向、超长跳过、剪贴板监听开关（30 分钟无文本自动暂停）、实时保存设置、8 款配色方案（默认雾隐）、字号、界面语言（中英）、托盘、窗口置顶与缩放。
- **手动输入**：原文框是可编辑输入框，直接敲单词或句子后按 `Enter`（或点「原文」标签行的「翻译」按钮）即译，`Shift+Enter` 换行、输入法组词时的 Enter 不触发；与复制即译**并存、不互斥**——聚焦原文框时复制新文本仍会自动翻译并覆盖框内草稿。手动与复制走同一条翻译管线（判向/上限/词典卡/历史）。
- 底栏一行说明来源：句子为「由 {模型名} 翻译」；词典卡为「由本地词典提供」或「由 deepseek-v4.1-flash-1017 详解」。

**本轮新增（2026-11-11 体验优化）**

- **历史与生词本**：工具条新增书本按钮，同窗切换「历史 / 生词本」两个标签。历史自动记录最近 100 条翻译（词/句、模型、时间），点行回看、行内复制、一键清空；生词本由词典卡右上角星标收藏，支持导出 CSV 与 Anki（制表符分隔）。数据存 `library.db`。
- **加载进度感**：加载态显示所用模型与已用秒数；单词详解额外标注「deepseek 通常需数秒」。
- **错误态提示**：失败时除服务端原文外，补充「检查 API Key 与接口地址；402 多为模型未启用，限流或超时可稍后重试」，仅文字、无跳转按钮。
- **窗口记忆**：位置与尺寸落盘 `window-state.json`（逻辑像素），重启恢复；**无存档的首次启动默认屏幕居中**。
- **全局热键** `Ctrl+Alt+T` 唤出/隐藏窗口，设置页可开关；被其他程序占用时自动禁用并提示。
- **开机自启**：设置页开关，**默认关**，写 HKCU Run 注册表（注册表为唯一事实源）。
- **单词缓存管理**：设置页显示条数与占用字节，可一键清空。
- 设置页删除「相关词条」占位行；外观组常开不折叠。

**本轮新增（2026-11-12 改名 + 配色方案）**

- **改名**：软件中文名「译雀」、英文名「Sparrow」。左上角品牌名与窗口标题随设置页「界面语言」中英切换（中文=译雀，English=Sparrow）；托盘「显示译雀」、`tauri.conf.json` 产品名/标题同步。
- **8 款配色方案**替换原「背景底色 + 多巴胺系列」：雾隐 Brume / 黛山 Slate / 陶土 Clay / 苔庭 Moss（莫兰迪与类莫兰迪·浅）、素笺 Ivory（高级感·浅）、墨玉 Onyx / 暮金 Dusk / 霁青 Celadon（高级感·深），**默认雾隐**。每款是一套完整色彩令牌（中性底 + 独立强调色 + 次强调色 + 语义色）；设置页以 2 列卡片选择（中英文名 + 浅/深标记 + 4 色预览条），选中与记忆存 `wb_theme`（方案 id）。强调色路由到开关、分段选中、原文左侧色条、词性、词典 chips、收藏星标。
- 界面语言切到 English 时，配色卡片的浅/深标记同步为 Light/Dark。

**本轮新增（2026-11-12 单实例 + 首启居中 + 图标候选）**

- **单实例（仅发布版）**：`tauri-plugin-single-instance` 以 `#[cfg(not(debug_assertions))]` 注册——release 二次启动转发到已有实例并自行退出（后台始终一个），并唤出/聚焦主窗；dev/debug 不注册，可多开调试。
- **首启居中**：`tauri.conf.json` `center:true` + 无存档时 `window.center()`；有存档仍恢复记忆位置。
- **图标已落地（方案 F 圆雀·浅色）**：用户选定 F 浅色款；源 `prototypes/icon-f-light.svg` + `icon-f-light-1024.png`，经 `tauri icon` 导出全格式替换 `src-tauri/icons`（exe/窗口/托盘共用），并清理仅移动端用的 `ios/`、`android/` 子目录。六款候选原型仍留 `prototypes/icon-studio.html` 备查。
- **winres 坑**：`tauri_build` 的 build script 仅对 `capabilities`/`tauri.conf.json` 设 rerun-if-changed，**不跟踪 icons**；只换图标不重跑 build script 会导致 exe 内嵌旧图标。换图标后需 `touch src-tauri/tauri.conf.json` 再构建。
- 2026-11-12 已打包发布到 `E:\译雀1.0`（含手动输入/单实例/首启居中/F 图标）；交付前旧文件已清空，使用数据先备份到 `E:\译雀1.0-数据备份\`。

**验证状态**：15 项请求体回归 + 25 项单词详解回归 + 13 项分档超时回归 + 8 项 Rust 单测 + 24 项真实窗口端到端（含新增 T1–T3 配色/品牌），全部通过；本轮真窗口截图见 `prototypes/shots-app/*.png`（品牌中英切换、8 款配色、深色方案、无溢出）。

---

## 快速开始

环境：Node.js 22+、Rust（含 Windows 上的 VS Build Tools）、Tauri 2 CLI（随 npm 依赖安装）。

```bash
npm install
cp config.local.example.json config.local.json   # Windows 用 copy
# 填入 apiKey，然后：
npm run tauri dev
```

> 图标等二进制资源以 base64 文本存于 `tools/assets.b64.json`；`npm install` 的 postinstall 会自动运行 `tools/restore-icons.mjs` 还原到 `src-tauri/icons/` 与原型源图，克隆后无需手动处理。

**获取 API Key**

1. 在 TokenHub 控制台开通服务，并在「模型广场」**启用你要用的模型**——未启用直接调用会返回 `402`。
2. 创建 API Key 并立刻复制保存（之后查不到）。
3. 两种方式二选一：
   - **界面填写**：设置 →「连接 → API Key」粘贴，自动保存；
   - **手改文件**：`config.local.example.json` 复制为 `config.local.json` 后填入 `apiKey`。

也可以在设置页切换长文本翻译模型（单词详解固定 deepseek，不可选），改动实时写回 `config.local.json`，无需重启。

**准备本地词典（可选，单词详解用）**

词库与软件分离存放。官方 ECDICT `stardict.db`（约 851MB）需先精简为查询用库：

```bash
cargo run --example prepare_dict -- <原始 stardict.db> <输出 ecdict.db>
# 构建后抽查：
cargo run --example prepare_dict -- --query <输出 ecdict.db> apple
```

再把 `config.local.json` 的 `dictPath` 指向输出文件（设置页「词典路径」也可直接改）。不准备词典也能用：单词会自动走 AI 详解并缓存。

---

## 配置

```json
{
  "defaultEngineId": "hy",
  "timeoutMs": 15000,
  "maxChars": 2000,
  "dictPath": "E:\\译笺词库\\ecdict.db",
  "engines": [{
    "id": "hy",
    "displayName": "混元翻译",
    "apiKey": "在这里填 API Key",
    "baseUrl": "https://tokenhub.tencentmaas.com/v1",
    "model": "hy-mt2-pro"
  }]
}
```

| 字段 | 说明 |
|---|---|
| `model` | 四选一，见下表，**初次默认 `hy-mt2-pro`**。决定句子翻译实际调用的模型与 `temperature` |
| `baseUrl` | TokenHub 的 `/v1` 地址，按控制台实际地域填写 |
| `timeoutMs` | 仅作**未登记模型**的超时兜底，默认 15 秒。四个已知模型由代码按档固定，见「请求超时」 |
| `maxChars` | 原文长度上限（200–2000，**默认 2000**）。超限直接跳过、**一个请求都不发**，界面给「仍要翻译」出口；各模型超时按 2000 字符标准校准 |
| `dictPath` | 词典库路径；相对路径按配置文件所在目录解析，缺省为同目录 `ecdict.db` |

**密钥安全**：`config.local.json` 与 `.env*` 已在 `.gitignore` 排除。密钥只由 Rust 从本机读取，不进浏览器存储、不进构建产物、不进任何会被提交的文件；设置页只更新白名单字段，写盘用临时文件 + 原子替换。

`baseUrl` 国内常见 `https://tokenhub.tencentmaas.com/v1`；官方文档另列广州 `https://tokenhub.tencentcloudmaas.com/v1`、新加坡 `https://tokenhub-intl.tencentcloudmaas.com/v1`。**Key 与地域绑定，不同站点不通用**。

---

## 软件架构

一句话：**网页层管业务与画面，Rust 层管系统能力，中间靠消息通道传话；连上网请求都要从网页绕回 Rust 发出去。**

| 层 | 文件 | 职责 |
|---|---|---|
| 表现层（WebView2，微软的网页渲染引擎，这里当窗口用） | `index.html`、`src/styles.css`、`src/main.ts` | 状态机、自动判向、渲染、设置与主题、全部事件 |
| 适配层（也在网页里） | `src/adapters/hy.ts`、`word.ts`、`types.ts`、`index.ts` | 构造 POST 请求体、解析响应；单词卡归一化与兜底请求体 |
| 边界（IPC，进程间通信，网页与 Rust 互发消息的通道） | `src/http.ts` + Rust 侧 30 个命令 | `invoke`（网页调 Rust）/ `listen`（Rust 通知网页） |
| 系统层（Rust） | `src-tauri/src/lib.rs`、`http.rs`、`config.rs`、`dict.rs`、`store.rs`、`system.rs` | 剪贴板 220ms 轮询、托盘、窗口圆角/置顶/尺寸/位置记忆、用 `reqwest` 转发 HTTP、配置原子写入、词典查询与 AI 缓存、历史/生词本/导出、全局热键、开机自启 |
| 外部 | TokenHub `/v1/chat/completions` | 单次 POST，一次性返回完整结果 |

数据链路：

```
复制文本
  → Rust 剪贴板轮询（220ms，比对序列号）
  → 网页 100ms 合并窗 + 内容去重
  → 长度拦截（超限跳过）/ 自动判向
  → 单词分流：英→中 且为单个英文单词 → 词典卡流程（见下）
  → 否则 buildPayload 构造请求体
  → IPC 交给 Rust → reqwest 发 HTTP
  → 响应原路返回 → trim() → 整段贴上窗口
```

- **自动判向**：分母只算「字母 + 汉字」，汉字占比 > 30% 判为中→英，否则英→中；点方向按钮可临时覆盖，下次复制新文本恢复自动。
- **自写入抑制**：复制译文写进剪贴板后，Rust 侧记录抑制槽，收到相同内容直接丢弃，不会二次翻译。
- Rust 只做系统与通用收发，**不懂翻译协议**；换引擎只改 `model` 字段，不需要动 Rust。

---

## POST 请求（核心）

`POST <baseUrl>/chat/completions`，请求头 `Authorization: Bearer <API Key>`、`Content-Type: application/json`。

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

`content` 末尾那句英文是 **`{source_text}` 占位符**，运行时由剪贴板内容整段替换；中文输入时 `Chinese` 换成 `English`。模板是 hy-mt2 官方 Default Translation 原文，`\n\n` 用来分隔指令与待译文本。请求体由 `src/adapters/hy.ts` 的 `buildPayload()` 统一构造；字段集合恒为 5 个。

| 字段 | 取值 | 依据 |
|---|---|---|
| `messages` | 单条 `user`，**无 system** | hy-mt2 官方「模型没有默认 system_prompt」；deepseek 执行这条明确指令也无需 system |
| `stream` | `false` | 一次性完整返回，不流式 |
| `temperature` | 见下表 | 三个 hy-mt2 用官方推荐 0.7；deepseek 按确定性任务取 0.3 |
| `max_tokens` | `4096` | 等于 hy-mt2 系列官方最大输出 4k，也是输出长度刹车。天花板不是预算 |
| `response_format` | **不传** | 平台默认 `{"type":"text"}`；本方案不用任何结构化输出 |

明确不传的字段：`top_p`（官方「一般只调 temperature 或 top_p 之一」，默认值 1.0 与 pro 推荐一致）、`repetition_penalty` / `top_k`（官方列为客户端传了会被静默忽略）、`stop` / `seed` / `thinking`。

**四个模型只有 `model` 与 `temperature` 不同**：

| 模型（API 参数） | temperature | 类型 |
|---|---:|---|
| `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` | 0.7 | 翻译专用模型 |
| `deepseek-v4.1-flash-1017` | 0.3 | 通用对话／推理模型 |

> 历史说明：`hy4` / `glm-5.3-flash` 已于 2026-11-11 下架。hy4 曾需 `thinking: {type:"disabled"}` + `max_tokens 2048` 才能正常出译文（推理链耗尽输出 token 的问题），glm 长段落耗时波动极大（15.8–52.2 秒）。实验记录见 `TEST_REPORT.md` 第十节，代码里不再保留它们的特殊分支。软件未正式发布，不做旧配置兼容。

**响应处理**：取 `choices[0].message.content`，只做 `trim()`，直接显示——不做引号剥离、前缀清洗或结构化解析。实测四模型 × 3 类文本共 12 次请求全部 `200 / finish_reason=stop`，译文无引号、无解释、无注释、无多余换行。`finish_reason=length`（被上限截断）、`content` 为空或响应带 `error` 时走错误态 + 重试；服务端错误原文照显，不做中文映射。

---

## 请求超时（按模型分档）

超时由 `src/config.ts` 的 `MODEL_TIMEOUT_MS` 按模型固定，`buildTranslators` 按引擎模型取值，最终作为 `timeout_ms` 传给 Rust 的 `reqwest`（夹在 1–120 秒）。配置里的 `timeoutMs` 只对未登记模型生效。单词 AI 兜底同样按所选模型取档。

| 模型 | 超时 | 1950 字符实测峰值 | 余量 |
|---|---|---|---|
| `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` | **12 秒** | 3.3 / 5.4 / 1.2 秒 | 2.2–10 倍 |
| `deepseek-v4.1-flash-1017` | **30 秒** | 11.6–14.4 秒 | 2 倍 |

数值按「1950 字符实测峰值 × 约 1.7–2.2 倍」取整。此前全局 15 秒、后来 8/30 秒两档都撑不住 2000 字符长段落。

**最终实测（2026-11-11，`node tests/timeout-live.mjs`，4/4 成功）**：hy-mt2 2.7 / 3.1 / 1.3 秒、deepseek 8.9 秒，全部 `finish_reason=stop` 且译文完整。首轮曾遇一次平台 429 限流（连发 12 请求后），重跑即恢复，与超时设置无关。

真实窗口复现（CDP）：1950 字符未被跳过（上限 2000 生效）；切到 deepseek 后长段落正常出译文；测试后配置模型已还原。

---

## 单词详解（词典卡）

触发条件：方向为英→中（含自动判向）且剪贴板内容是**单个英文单词**（纯字母，允许词内撇号/连字符，≤40 字符）。查词顺序：

```
词典精确匹配 → 词典小写匹配 → 变形反查原形（inflections 表） → AI 缓存（word_cache.db）
以上皆无 → AI JSON 模式兜底（默认 deepseek-v4.1-flash-1017，可设置） → 校验通过写缓存
任一环节不可用 → 静默降级为句子翻译（永远有结果，不弹错）
```

- 词典库由 `src-tauri/examples/prepare_dict.rs` 从官方 ECDICT 构建：只留查询用到的 11 列 + `inflections(form→lemma)` 变形反查表；`exchange` 字段的 `p/d/i/r/t/s` 值映射到词条本身、`0` 值映射到原形。
- 词条存在但释义为空的（部分冷门变形词）视同未命中，继续反查原形。
- AI 兜底**固定模型** `deepseek-v4.1-flash-1017`（TokenHub 已确认支持 `response_format: json_object`；hy-mt2 系列不支持结构化输出，故不做可选）；凭证复用当前引擎的 `apiKey` / `baseUrl`，与句子翻译请求体完全独立；`json_object` 只保证合法 JSON，客户端仍做形状校验，失败重试 1 次；失败静默降级为句子翻译。
- 缓存库 `word_cache.db` 固定放在配置文件同目录（可写位置），与只读词典分离；删掉即清空缓存。
- 词典卡内容：原形提示（查询词是变形时）→ 词头 + 音标 → 柯林斯星级 / 牛津核心词 / 考纲 chips → 按词性分组的释义 → 例句（AI 详解时）。复制按钮复制释义行。

兜底请求体（与句子模式互不影响）：

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

---

## 界面

- 窗口 **360×560**、无边框圆角、透明背景；右下角可拖拽缩放，缩放热区不可见。
- 顶部工具条：左上品牌名「译雀 / Sparrow」（随界面语言中英切换）；右侧依次为监听开关 / 置顶 / 切换方向 / **历史与生词本** / 设置 / **最小化** / 收进托盘（X）。最小化把窗口收进任务栏，X 是隐藏到托盘，两者不同。图标悬停显示名称。
- 内容区只有原文与译文两块，长文各自独立滚动；句子与段落是一段纯文本，**单个英文单词（英→中）显示词典卡**。加载 / 错误 / 超长跳过的提示属于内容区。原文块为可编辑 `textarea`（不再截断显示），「原文」标签行右侧有「翻译」按钮；`Enter` 翻译、`Shift+Enter` 换行，空框显示本地化占位提示。
- 底栏一行说明来源：句子为「由 {模型名} 翻译」；词典卡为「由本地词典提供」或「由 deepseek-v4.1-flash-1017 详解」。不显示字数、模式或状态文案。
- 设置页同窗切换，分连接 / 行为 / 外观三组：API Key、接口地址、**长文本翻译模型（四选一，初次默认 pro）**、剪贴板监听、长度上限（200–2000）、**词典路径 + 词典状态**（单词详解常开、无开关、模型固定 deepseek）、**单词缓存统计 + 清空**、**全局热键开关（Ctrl+Alt+T）**、**开机自启开关（默认关）**；外观组（界面语言、字号、**配色方案 8 选 1 默认雾隐**、窗口置顶）**常开不折叠**。
- **没有保存按钮**：文本与模型改动防抖 500ms 自动写回 `config.local.json`；字号、配色方案、监听、置顶写入浏览器本地存储并在下次启动恢复（界面语言每次启动默认中文，不记忆）。
- 历史 / 生词本页同窗切换（工具条书本按钮进入）：顶部「历史 / 生词本」两标签 + 清空按钮；历史行显示原文/译文/模型/时间，点行回看、行内复制；生词本行点按回显词典卡、可删除，标签下方「导出 CSV / 导出 Anki」按钮仅在生词本标签出现。词典卡右上角星标收藏到生词本。
- API Key 隐藏时用掩码占位，点眼睛才从本机配置读出明文；密钥不进浏览器存储。

`preview.html` 是单文件静态视觉基准，双击即可打开，不发请求。词典卡的视觉稿已落地为真实界面。

---

## 轻量与性能

- 零第三方 JS 库；`reqwest` 关掉默认特性只开 `native-tls`，全局复用一个 HTTP 连接池；无常驻定时器、无多窗口。唯一的持久缓存是单词 AI 详解结果（`word_cache.db`），词典本身只读不缓存。
- **请求体开销（真实实测，单位 token，即模型计费单位）**：句子模式输入 24–62、输出 8–15（hy-mt2 系列）。单词走词典卡，命中词典时**零请求**；AI 兜底单次输入约 90、输出约 150，且结果进缓存不重复花钱。
- **已知成本差异**：`deepseek-v4.1-flash-1017` 是推理模型，会先产生推理内容（走 `reasoning_content` 单独字段，不污染译文，但按输出 token 计费）；长段落推理耗时可到 14 秒以上。三个 hy-mt2 翻译专用模型无推理链，输出 token 明显更低。
- `max_tokens` 是输出长度的物理刹车（句子 4096、单词兜底 2048），正常输出远用不完；一次退化最多烧满该上限，不会无限输出。

---

## 验证

```bash
# 前端与类型
npx tsc --noEmit
npx vite build

# 请求体回归（离线，15 项）
node tests/payload.test.mjs

# 单词详解回归（离线，25 项：单词判定 / 兜底请求体 / 释义归一化 / JSON 校验）
node tests/word.test.mjs

# 分档超时回归（离线，13 项，含默认模型与上限夹取）
node tests/timeout.test.mjs

# 四模型真实 API 实测（需 config.local.json + 联网，12 次请求）
node tests/live.mjs

# 1950 字符长段落四模型耗时实测（需联网）
node tests/timeout-live.mjs

# Rust 侧单测（配置合并、HTTP 参数校验、exchange 解析；联网探针默认忽略，不需要真实密钥）
cargo test --manifest-path src-tauri/Cargo.toml --lib

# 真实窗口端到端（21 场景：句子与设置 11 + 单词 5 + 历史/生词本/系统能力 5，需先带 CDP 端口启动）
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
node tests/e2e.mjs

# 体验优化可视化验证（需先带 CDP 端口启动；截图存 tests/shots/d-*.png，跑完自恢复配置与缓存）
node tests/verify-d.mjs

# 发布版冒烟（4 场景：无密钥词典卡 / 设置页词典状态 / 保存不覆盖配置；需先带 CDP 端口启动发布版 exe）
node tests/release-smoke.mjs

# 日常使用
npm run tauri dev
```

端到端脚本会切换长文本模型做验证，**跑完会还原测试开始时的长文本模型与长度上限**，并用断言（E9）保证 `config.local.json` 的 `model` 与 `maxChars` 没被改动。`verify-d.mjs` 同样在结束时还原接口地址、模型、上限、缓存与收藏，并删除导出测试文件。

结果文件：`TEST_REPORT.md`（完整报告，含逐条输入输出）、`tests/live-results.json`、`tests/e2e-results.json`、`tests/timeout-live-results.json`、`tests/release-smoke-results.json`、`tests/shots/d-*.png`。所有结果文件都不含密钥。

---

## 打包

```bash
npm run tauri build -- --no-bundle
# 产物：src-tauri/target/release/clipboard-translator.exe（便携版，双击即用）
```

把 exe 与 `config.local.json` 放同一目录即可（配置查找顺序：当前目录 → 父目录 → exe 所在目录及上溯五层）。**发布包不含密钥**：配置里 `apiKey` 留空，首次启动在设置页粘贴一次即自动保存。发布目录为 `E:\译雀1.0`（**译雀.exe** + 无密钥配置 + 使用说明.txt）；2026-11-12 最新一次打包含手动输入/单实例/首启居中/F 图标，交付前旧文件已清空（使用数据备份于 `E:\译雀1.0-数据备份\`）。

---

## 目录

```
index.html / src/styles.css / src/main.ts      界面与交互
PROJECT_HANDOFF.md                             迁移交接说明（面向接手开发者）
src/adapters/hy.ts                             句子 POST 构造、响应处理
src/adapters/word.ts                           单词判定、释义归一化、兜底请求体与校验
src/adapters/types.ts / index.ts               类型与适配器注册表
src/config.ts / src/http.ts                    配置读写、调用 Rust 的 HTTP 命令
src-tauri/src/  lib.rs · http.rs · config.rs   窗口 / 剪贴板 / 托盘 / 转发 / 配置
src-tauri/src/dict.rs                          词典查询、变形反查、AI 缓存（3 个 IPC 命令）
src-tauri/src/store.rs                         历史 / 生词本 / 导出 / 缓存统计（9 个 IPC 命令，library.db）
src-tauri/src/system.rs                        全局热键 / 开机自启（4 个 IPC 命令，注册表）
src-tauri/examples/prepare_dict.rs             官方 ECDICT → 精简词库 + 变形表
config.local.example.json                      配置模板（不含真实密钥）
preview.html                                   静态视觉基准
tests/                                         单元、真实 API、真实窗口端到端脚本与数据
TEST_REPORT.md                                 测试报告（含单词详解、体验优化两节）
```

运行期在配置同目录生成（不入库、不含密钥）：`library.db`（翻译历史 cap 100 + 生词本收藏）、`word_cache.db`（单词 AI 详解缓存）、`window-state.json`（窗口位置与大小记忆）。

---

## 已知边界

- 单词详解只覆盖英→中方向；中→英复制单个词仍走句子翻译。详解常开、无开关；词典未收录且 AI 兜底失败时静默降级为句子翻译，不弹错误。
- deepseek 是推理模型，输出 token 明显高于翻译专用模型（见「轻量与性能」）。
- 单词详解固定 deepseek；AI 兜底失败自动降级为句子翻译，不会弹错。
- 剪贴板原文在网页侧 `clipboard-changed` 入口**统一 `trim()`**：Rust 侧读到的仍是原始文本（只用 `trim().is_empty()` 判断空白内容并跳过），前端收到后去掉首尾空白，之后的**显示、去重、长度判断与 POST 模板拼接全用同一个干净值**，全空白内容直接忽略。模型返回的译文也做 `trim()`。
- 剪贴板是 220ms 轮询序列号，不是事件式监听，最多约 220ms 延迟。
- 监听 30 分钟空闲自动暂停：30 分钟内没收到任何文本剪贴板内容就自动暂停（与手动暂停同一路径，状态持久化，重启后保持暂停），需手动重新打开；收到任何文本即重置计时。文件、图片等非文本内容不触发翻译，也不算活动。
- 历史仅存最近 100 条（`library.db`），超出自动淘汰最旧；生词本收藏无上限，可导出 CSV / Anki。相关词条（同义/反义联想）尚未实现。
- 未做：LRU 缓存淘汰、划词/截图 OCR、Rust 原生窗口重写。（全局热键、窗口位置/大小记忆、翻译历史、生词本、开机自启均已实现，见「本轮新增」。）
- 界面语言有中文 / English 两套；译文目标语由自动判向决定，不是固定中文。
