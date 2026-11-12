# 译雀 / Sparrow

复制即翻译的极简 Windows 桌面浮窗。监听剪贴板，复制文本立刻出译文；复制单个英文单词出结构化词典卡。也支持在原文框手动输入翻译。

Tauri 2（Rust 系统外壳）+ Vanilla TypeScript 前端，零第三方前端 JS 库，便携单 exe。

## 功能

- **复制即译**：监听剪贴板，自动判向（英↔中），复制即出结果。
- **手动输入**：原文框可编辑，`Enter` 或点「翻译」即译，`Shift+Enter` 换行；与复制即译并存、不互斥。
- **单词词典卡**：单个英文单词（英→中）优先查本地 ECDICT 词典（音标/词性/释义/考纲标记），未收录时 AI 兜底并缓存。
- **长度保护**：超上限（默认 2000 字符，可调 200–2000）跳过不发请求，给「仍要翻译」出口。
- **历史与生词本**：自动记录最近 100 条；生词本收藏，导出 CSV / Anki。
- **系统集成**：托盘、全局热键 `Ctrl+Alt+T`、开机自启（默认关）、窗口位置记忆、首启居中、发布版单实例。
- **外观**：8 套莫兰迪/高级感配色、字号调节、中英双语界面、窗口置顶与缩放。
- **竞态防护**：递增请求编号，迟到的旧响应自动丢弃，界面永远是最新一次翻译。

## 环境要求

- Windows 10/11（WebView2）
- Node.js 22+
- Rust（Windows 需 VS Build Tools）
- 一个兼容 OpenAI Chat Completions 的翻译 API（默认配置指向腾讯 TokenHub 混元翻译）

## 快速开始

```bash
git clone https://github.com/sweetbellpepper/clipboard-translator.git
cd clipboard-translator
npm install                      # postinstall 自动还原图标资源
cp config.local.example.json config.local.json   # Windows 用 copy
# 编辑 config.local.json，填入 apiKey
npm run tauri dev                # 开发运行
```

构建便携 exe：

```bash
npm run tauri build -- --no-bundle
# 产物：src-tauri/target/release/clipboard-translator.exe
```

> 图标等二进制资源以 base64 存于 `tools/assets.b64.json`，`npm install` 时由 `tools/restore-icons.mjs` 自动还原到 `src-tauri/icons/`，无需手动处理。

## 配置

`config.local.json`（**已被 .gitignore 排除，切勿提交真实密钥**）：

| 字段 | 说明 |
|---|---|
| `engines[].apiKey` | API Key，仅本机保存 |
| `engines[].baseUrl` | API 地址（与 Key 地域绑定） |
| `engines[].model` | 句子翻译模型（hy-mt2-pro / plus / lite / deepseek-v4.1-flash-1017） |
| `maxChars` | 原文长度上限 200–2000，默认 2000 |
| `timeoutMs` | 未登记模型的兜底超时，默认 15000 |
| `dictPath` | 本地 ECDICT 词典路径（可选；缺失时单词走 AI 兜底） |

单词 AI 兜底固定使用 `deepseek-v4.1-flash-1017`（结构化输出），不可改。

### 本地词典（可选）

用官方 [ECDICT](https://github.com/skywind3000/ECDICT) 精简构建：

```bash
cargo run --example prepare_dict -- <ecdict.csv> <out.db>
```

只保留查询用到的列 + 变形反查表；把 `dictPath` 指向产物即可。

## 使用

- 复制任意文本 → 浮窗自动翻译；复制单个英文单词 → 词典卡。
- 原文框手动输入 → `Enter` / 「翻译」按钮；`Shift+Enter` 换行。
- `Ctrl+Alt+T` 唤出/隐藏；X 收进托盘；右下角拖拽缩放。
- 工具条书本按钮 → 历史 / 生词本；生词本可导出 CSV / Anki。

## 项目结构

```
├─ index.html / src/            前端（Vanilla TS + CSS）
│  └─ adapters/                 翻译请求适配（请求体模板冻结）
├─ src-tauri/                   Rust 外壳（剪贴板/词典/存储/HTTP/系统）
│  └─ examples/prepare_dict.rs  ECDICT 精简构建
├─ tools/                       图标 base64 + 还原脚本
├─ tests/                       离线回归 + 真实窗口 CDP 端到端
├─ config.local.example.json    无密钥配置示例
└─ vite.config.ts / tsconfig.json / package.json
```

## 测试

```bash
node tests/payload.test.mjs     # 请求体模板回归
node tests/word.test.mjs        # 单词判定/兜底/校验
node tests/timeout.test.mjs     # 分档超时
# 真实窗口端到端（需带调试端口启动）：
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
node tests/e2e.mjs              # 剪贴板/单词/历史/配色
node tests/manual-e2e.mjs       # 手动输入
node tests/race-e2e.mjs         # 竞态防护
```

## 安全

- 真实密钥只存本机 `config.local.json`（gitignore 排除），不进浏览器存储、不进构建产物、不入库。
- 句子请求体为冻结模板（5 字段），不擅自增改。

## 许可证

[MIT](LICENSE)