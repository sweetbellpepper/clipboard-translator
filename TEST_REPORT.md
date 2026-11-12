# 译雀 · 完整测试报告（累计：句子翻译 / 单词详解 / 体验优化 / 改名与配色）

> **本报告为累计日志**：第一–十二节是 2026-11-10～11 各轮的历史快照（当时六引擎、单词按句子翻译），其后被第十三–十六节逐轮取代。**当前基线以第十五节（单词模型固定 + 上限 2000 + 默认 pro）与第十六节（体验优化，e2e 21/21）为准**；当前句子模型只有四个，英→中单个英文单词走词典卡。下方原始头部保留作历史追溯。

- **初版测试日期**：2026-11-10（历史快照头部）
- **初版测试对象**：按审核定稿方案重构的翻译引擎（大模型翻译句子，单个单词也按句子翻译；六个引擎）
- **旧方案状态**：`json_schema` / `B|`·`S|` 行格式 / 旧词典卡 / 相关词条 / 精简模式全部推翻并下线（现行词典卡为 SQLite + AI JSON 兜底，非旧方案）
- **初版一句话结论**：**14 项请求体回归 + 18 次真实 API 实测 + 9 项真实窗口端到端 = 41 项全部通过**（历史；当前累计回归见第十六节：payload 15 / word 25 / timeout 13 / Rust 8 / e2e 21）。

---

## 一、本版做了什么

| 项 | 实现 |
|---|---|
| 请求层 | `src/adapters/hy.ts` 只剩一条句子通路；六个引擎共用请求骨架，只有 `model` 与 `temperature` 不同 |
| 引擎清单 | `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite`（0.7）、`hy4` / `glm-5.3-flash` / `deepseek-v4.1-flash-1017`（0.3） |
| 类型层 | `TranslateRequest` 删除 `mode`；`TranslateResult` 只剩纯译文；删除 `WordCard` / `SenseGroup` |
| 展示层 | 单词不再进词典卡，统一 `renderText` 显示一段译义（`model` → `模型`）；删除 `wordView.ts`、`baseRow`、`renderWord` 及单词模式判定 |
| 设置页 | 「单词详解」与「相关词条」均显示「功能未实现」，去掉失效开关；`preview.html` 视觉基准同步 |
| 响应处理 | 只 `trim()`，不做引号剥离/前缀清洗/结构化解析；`finish=length` 或错误 → 错误态；服务端错误原文照显（删掉原有的 429 中文映射） |
| 底栏 | 仍是「由 {模型名} 翻译」，模型名随所选引擎动态变化 |

---

## 二、POST 请求体（审核稿逐字实现）

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

`content` 末尾那句英文是 **`{source_text}` 占位符**，运行时由剪贴板内容整段替换；中文输入时 `Chinese` 换成 `English`。模板是 hy-mt2 官方 Default Translation 原文，`\n\n` 用来分隔指令与待译文本。

| 字段 | 取值 | 依据 |
|---|---|---|
| `messages` | 单条 `user`，无 `system` | hy-mt2 官方「模型没有默认 system_prompt」；通用对话模型执行这条指令也无需 system |
| `stream` | `false` | 一次性完整返回 |
| `temperature` | hy-mt2 系列 `0.7`；其余 `0.3` | 用户拍板：三个 hy-mt2 与 pro 参数一致；翻译是确定性任务 |
| `max_tokens` | `4096` | 等于 hy-mt2 系列官方最大输出 4k，也是输出刹车 |
| `response_format` | 不传 | 平台默认 `{"type":"text"}` |
| `top_p` | 不传 | 官方「一般只调 temperature 或 top_p 之一」；默认值 1.0 与 pro 官方推荐一致 |
| `repetition_penalty` / `top_k` | 不传 | 官方明确列为客户端传了会被静默忽略的字段 |

**请求体字段集合恒为 5 个**，单元测试逐项校验。

---

## 三、六个引擎参数对照

| 模型（API 参数） | temperature | 官方能力栏 | 上下文 / 最大输出 |
|---|---|---|---|
| `hy-mt2-pro` | 0.7 | 翻译旗舰，**无 Structured Output** | 8k / 4k |
| `hy-mt2-plus` | 0.7 | 翻译模型，指令遵循优秀 | 8k / 4k |
| `hy-mt2-lite` | 0.7 | 轻量低延迟翻译 | 8k / 4k |
| `hy4` | 0.3 | 深度推理、Structured Output | 1M / 64k |
| `glm-5.3-flash` | 0.3 | 深度推理、Structured Output | 1M / 128k |
| `deepseek-v4.1-flash-1017` | 0.3 | 深度推理、Structured Output（平台版） | 1M / 384k |

四款模型走同一个 TokenHub 端点、同一个 Base URL、同一个 Key，只换 `model`。

---

## 四、真实 API 实测：18 用例输入 → 输出

完整请求体、未截断原始响应、token 明细见 `tests/live-results.json`（不含密钥）。

| ID | 模型 | 输入 | 输出（原文） | in | out | finish | 思考 | 判定 |
|---|---|---|---|---:|---:|---|---|---|
| S1 | hy-mt2-pro | `The committee has reached a consensus on the annual budget.` | 委员会已就年度预算达成共识。 | 47 | 9 | stop | 否 | PASS |
| S2 | hy-mt2-pro | `过度包装不仅浪费资源，还会误导消费者。` | Excessive packaging not only wastes resources but also misleads consumers. | 46 | 15 | stop | 否 | PASS |
| S3 | hy-mt2-pro | `model` | 模型 | 37 | 2 | stop | 否 | PASS |
| S1 | hy-mt2-plus | 同 S1 | 委员会就年度预算达成了共识。 | 34 | 9 | stop | 否 | PASS |
| S2 | hy-mt2-plus | 同 S2 | Excessive packaging not only wastes resources but also misleads consumers. | 33 | 14 | stop | 否 | PASS |
| S3 | hy-mt2-plus | `model` | 模型 | 24 | 2 | stop | 否 | PASS |
| S1 | hy-mt2-lite | 同 S1 | 委员会就年度预算达成共识。 | 35 | 8 | stop | 否 | PASS |
| S2 | hy-mt2-lite | 同 S2 | Over-packaging not only wastes resources but also misleads consumers. | 34 | 15 | stop | 否 | PASS |
| S3 | hy-mt2-lite | `model` | 模型 | 25 | 2 | stop | 否 | PASS |
| S1 | hy4 | 同 S1 | 委员会已就年度预算达成共识。 | 53 | 92 | stop | **是** | PASS |
| S2 | hy4 | 同 S2 | Excessive packaging not only wastes resources but also misleads consumers. | 52 | 305 | stop | **是** | PASS |
| S3 | hy4 | `model` | 模型 | 43 | 241 | stop | **是** | PASS |
| S1 | glm-5.3-flash | 同 S1 | 委员会已就年度预算达成共识。 | 44 | 127 | stop | **是** | PASS |
| S2 | glm-5.3-flash | 同 S2 | Excessive packaging not only wastes resources but also misleads consumers. | 43 | 128 | stop | **是** | PASS |
| S3 | glm-5.3-flash | `model` | 模型 | 34 | 192 | stop | **是** | PASS |
| S1 | deepseek-v4.1-flash-1017 | 同 S1 | 委员会已就年度预算达成共识。 | 62 | 46 | stop | **是** | PASS |
| S2 | deepseek-v4.1-flash-1017 | 同 S2 | Excessive packaging not only wastes resources but also misleads consumers. | 61 | 59 | stop | **是** | PASS |
| S3 | deepseek-v4.1-flash-1017 | `model` | 模型 | 52 | 100 | stop | **是** | PASS |

**噪声检查**：18 条响应全部无成对引号、无解释前缀、无注释、无多余换行 → 不需要任何响应清洗或额外提示词约束。

### 各引擎输出 token 合计（3 个用例）

| 模型 | PASS | 输出合计 | 默认开启思考 |
|---|---:|---:|---|
| hy-mt2-pro / plus / lite | 3/3 | 26 / 25 / 25 | 否 |
| hy4 | 3/3 | **638** | 是 |
| glm-5.3-flash | 3/3 | **447** | 是 |
| deepseek-v4.1-flash-1017 | 3/3 | **205** | 是 |

同样查 `model → 模型`：pro 花 2 输出 token，hy4 花 241（约 120 倍）。推理链走 `reasoning_content` 单独字段，**不污染译文**，但按 `completion_tokens` 计费。这是成本差异，不是正确性差异。

---

## 五、真实窗口端到端：9 场景

完整数据见 `tests/e2e-results.json`。用 WebView2 CDP 写剪贴板、读真实 DOM，无需人工参与。

| ID | 输入动作 | 界面实际输出 | 结果 |
|---|---|---|---|
| E1 | 复制英文句子 | 只有「委员会就年度预算达成了共识。」；无词典卡；底栏 `由 hy-mt2-plus 翻译` | ✓ |
| E2 | 复制中文句子 | 自动判向，输出英文译文 | ✓ |
| E3 | 复制 `model` | 纯译文「模型」，**不再是词典卡**，无音标/词性 | ✓ |
| E4 | 打开设置页 | 单词详解、相关词条均为「功能未实现」，无残留开关按钮 | ✓ |
| E5 | 读模型下拉框 | 恰好 6 个引擎，顺序与方案一致 | ✓ |
| E6 | 切到 `hy4` + 复制句子 | 正常译文；底栏自动变 `由 hy4 翻译` | ✓ |
| E7 | 恢复原引擎 + 复制 `model` | 译文「模型」；底栏 `由 hy-mt2-plus 翻译` | ✓ |
| E8 | 点复制 | 剪贴板「模型」= 界面译文 | ✓ |
| E9 | 读 `config.local.json` | 测试前后模型均为 `hy-mt2-plus`，**配置未被测试改动** | ✓ |

E9 是补上的防护：首次跑端到端时脚本把引擎硬编码恢复成 `hy-mt2-pro`，擅自改了用户配置；已改为「记录原值 → 跑完还原 + 断言」，并把配置还原到测试前的 `hy-mt2-plus` 后重跑验证。

---

## 六、其他验证

| 项 | 结果 |
|---|---|
| `tests/payload.test.mjs` 请求体回归 | **14/14**（模板逐字、6 引擎参数、字段集合恰好 5 个、无旧方案痕迹、六引擎仅两字段不同） |
| `npx tsc --noEmit` | 通过 |
| `npx vite build` | 通过 |
| `preview.html` 内联 JS 语法 | 通过 |

---

## 七、结论与待决

1. **协议层与行为层均已确认**：6 引擎 × 3 类文本全部 200 / `stop` / 干净译文。此前担心的「通用模型加引号、加解释、换行」没有发生，响应只 `trim()` 即可。
2. **请求体零改动**：冒烟实测后没有新增或调整任何字段、参数或提示词，实现与审核稿逐字一致。
3. **思考模式是唯一已知成本差异**：三个通用模型默认返回 `reasoning_content`。用户已接受「第一步不传任何 thinking 字段、靠实测观察」；现在数据已观察到。若要尝试关闭，需先逐模型验证平台支持的关闭参数（官方警告不同模型支持度不一、传错会 400），**这会改动审核过的请求体，需另行给方案**。
4. **接口预留**：第二步接本地词典时，只需在剪贴板事件入口加分流（单词命中词典 → 出卡；否则 → 走本 POST），本 POST 层不用再改。
5. `tests/screenshot-*.png` 是上一版词典卡框架的视觉留档，当前版本不再产生词典卡；`preview.html` 保留该视觉稿作为第二步基准。

---

## 八、复现命令

```bash
# 单元（无需联网）
node tests/payload.test.mjs

# 真实 API 实测（需 config.local.json + 联网，18 次请求）
node tests/live.mjs

# 真实窗口端到端（需带 CDP 端口启动）
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
node tests/e2e.mjs

# 日常使用
npm run tauri dev
```

*报告由自动化实测数据生成；所有 token 数字、原始响应与判定均可在 `tests/*.json` 中逐条复核。*

---

## 九、请求超时分档实测（2026-11-10，已被第十节的 2000 字符标准取代）

需求：hy-mt2 三个模型 8 秒，hy4 / glm-5.3-flash / deepseek-v4.1-flash-1017 三十秒。此前是全局 15 秒，长段落推理模型会报错。

**实现**：`src/config.ts` 的 `MODEL_TIMEOUT_MS` 按模型固定（`satisfies Record<MODEL_CHOICES>` 保证新增模型必须补档），`buildTranslators` 按引擎模型取超时传给 `createHyTranslator` → `http.ts` → Rust `reqwest`（平台夹 1–60 秒）。配置里的 `timeoutMs: 15000` 仅作未登记模型兜底。

**888 字符英文长段落，真实 `buildPayload` 直连（`node tests/timeout-live.mjs`，结果在 `tests/timeout-live-results.json`）**

| 模型 | 分档 | 实测耗时 | 结果 |
|---|---|---|---|
| hy-mt2-pro | 8s | 1.9s | OK，余量 6.1s |
| hy-mt2-plus | 8s | 1.7s | OK，余量 6.3s |
| hy-mt2-lite | 8s | 0.7s | OK，余量 7.3s |
| deepseek-v4.1-flash-1017 | 30s | 5.4s | OK，余量 24.6s |
| glm-5.3-flash | 30s | 22.3s | OK，余量 7.7s |
| hy4 | 30s | 30.0s | **TIMEOUT** |

60 秒上限补测：glm 27.3s / 17.1s（波动大，30s 最窄余量 2.7s）；**hy4 两次均 41.3s 返回且 `out=4096`、`finish_reason=length`**，即输出撞满 `max_tokens` 被截断，程序仍显示错误态——这是模型输出退化，不是超时能解决的。

**真实窗口复现（CDP，4/4）**：hy-mt2-pro 长段落 2.0s 出译文；切到 glm 后同一段落 **24.7s 正常出译文**（旧 15s 必定超时），底栏 `由 glm-5.3-flash 翻译`；测试后配置模型已还原为 `hy-mt2-pro`。

**结论**：8 秒对三个 hy-mt2 充足；30 秒对 deepseek 充足、对 glm 够但余量偏窄；**30 秒对 hy4 不够，且放宽超时也救不回来**，需另行决策（限制 hy4 长文本，或调整输出上限/停止条件——都会改动审核过的 POST）。

**其他验证**：`tests/timeout.test.mjs` 8/8（含映射完备性、未知模型兜底、clamp 范围）、请求体回归 14/14、tsc、vite build 全过。

---

## 十、2000 字符标准重校准（2026-11-11）

需求：默认长度上限 1000 → 2000；全部模型超时按 2000 字符标准留裕量；glm 单独放宽；hy4 调整输出上限与停止条件。

**诊断（1950 字符标准段落，宽松 120 秒上限）**

| 模型 | 耗时 | 结果 |
|---|---|---|
| hy-mt2-pro / plus / lite | 3.3 / 5.4 / 1.2s | 正常 |
| hy4 | 40.0s | `finish=length`，输出 4096 token，**译文 0 字符**，推理链 12685 字符 |
| glm-5.3-flash | 52.2s | 正常（另一轮 15.8s，波动极大） |
| deepseek-v4.1-flash-1017 | 11.6s | 正常 |

结论：hy4 不是「译文写完不停」，而是推理链把输出 token 全耗光、还没开始写译文。第九节里「放宽超时也救不回来」的判断成立，但根因此前没定位到推理链。

**hy4 五组参数实验**

| 组合 | 耗时 | 结果 |
|---|---|---|
| 现状 4096 | 39.6s | `length`，译文 0 字符 |
| `max_tokens=8192` | 79.5s | `length`，推理 25367 字符，译文 0 字符 |
| `max_tokens=8192 + stop` | 17.4s | `stop` 但译文 0 字符（推理阶段被截断） |
| `reasoning_effort=low` | 39.8s | 无效 |
| `reasoning_effort=low + 8192` | 76.7s | 无效 |
| **`thinking: {type:"disabled"}`** | **5.0s** | **`stop`，译文 587 字符，零推理，输出 339 token** |

唯一有效解是关闭思考。落地：hy4 请求体额外传 `thinking: {type:"disabled"}`，`max_tokens` 从 4096 收到 2048（正常输出 6 倍余量，失控时更快失败）；不加 `stop`（实测有害）。其余五个模型请求体逐字不变。

**最终超时表（按实测峰值约 1.7–2.2 倍取整）**

| 模型 | 旧值 | 新值 | 最终实测耗时 |
|---|---|---|---|
| hy-mt2 三个 | 8s | **12s** | 2.7 / 3.4 / 1.2s |
| hy4 | 30s | **30s** | 4.9s（关闭思考后） |
| glm-5.3-flash | 30s | **90s** | 15.8s |
| deepseek | 30s | **30s** | 14.4s |

Rust `http.rs` 的 clamp 上限 60s → **120s**，否则 glm 的 90s 会被夹回 60s。`DEFAULT_MAX_CHARS`、两个 `config.local.json`、设置页输入框默认值同步改为 2000。

**验证**：`tests/timeout.test.mjs` 11/11、`tests/payload.test.mjs` 15/15、tsc、cargo check、vite build；1950 字符真实 API 实测 **6/6 全部 `stop` 且译文完整**；真实窗口 CDP **4/4**（1950 字符未被跳过、hy4 5.7s 出译文、glm 49.5s 出译文、配置还原）。

---

## 十一、单词详解（2026-11-11）

本地词典（ECDICT 精简库 3,402,564 词条 + 224,726 行变形反查表）+ DeepSeek JSON 模式兜底 + 本地缓存，全链路落地。

**离线回归**

| 套件 | 结果 | 覆盖 |
|---|---|---|
| `tests/word.test.mjs` | 25/25 | 单词判定 7、兜底请求体 6、释义归一化 7、JSON 校验 5 |
| `tests/payload.test.mjs` | 15/15 | 句子请求体逐字未破坏（关键回归） |
| `tests/timeout.test.mjs` | 11/11 | 分档超时 |
| `cargo test --lib` | 8 passed | 含 `parse_exchange` 三条：变形→词条、`0:`→原形、空值跳过 |
| `npx tsc --noEmit` / `vite build` | 通过 | — |

**真实窗口端到端 14/14**（`tests/e2e.mjs`，结果见 `tests/e2e-results.json`）

| 用例 | 结果 |
|---|---|
| E1–E2 英/中句子纯译文 | ✓ |
| E3 单词 model → 词典卡（词性 n./a./vi./vt.，底栏「由本地词典提供」） | ✓ |
| E4 设置页：详解开关 + 「词典已加载 · 约 3,402,564 词条 · 变形反查已就绪」，相关词条仍「功能未实现」 | ✓ |
| E5–E7 六引擎下拉、切 hy4、还原引擎 | ✓ |
| E8 句子复制 = 界面译文 | ✓ |
| W1 apple → 音标 /'æpl/ + chips 柯林斯 3 星、牛津核心词、中考、高考 | ✓ |
| W5 词典卡复制 = 释义行（不含音标/chips） | ✓ |
| W4 befallen → 词典自身释义「befall的过去分词」，底栏词典来源 | ✓ |
| W2 skibidi → 真实 AI 兜底 13.0s 出卡（interj./adj./n. + 例句），底栏「由 deepseek-v4.1-flash-1017 详解」 | ✓ |
| W3 skibidi 二次查询 → 缓存命中 0.4s | ✓ |
| E9 测试结束配置模型未改动 | ✓ |

**UI 截图**：`tests/shot-dict-apple.png`（词典卡）、`tests/shot-ai-skibidi.png`（AI 详解卡）。

**边界与降级**：词典文件缺失/损坏不弹错，直接走 AI 兜底；AI 失败静默降级句子翻译；词条存在但释义为空（如部分冷门变形词）视同未命中继续反查原形；`dictEnabled` 关闭后单词回到句子翻译。

**1.0 打包与发布版冒烟（2026-11-11）**

`npm run tauri build -- --no-bundle` 出便携 exe，交付目录 `E:\译笺1.0`（译笺.exe + 无密钥 config.local.json + 使用说明.txt）。发布版冒烟 `tests/release-smoke.mjs` **4/4**：无密钥时 apple/model 词典卡正常、设置页词典状态已加载、设置页保存不覆盖 dictPath。修复后开发窗口全量 e2e 复跑 **14/14**。

冒烟暴露并修复的两个真 bug（开发环境有 Key 故此前未暴露）：

1. **无密钥时词典卡被跳过**：`tryWordFlow` 先调 `ensureConfig`（校验凭证），Key 为空即抛错返回 false，连不需要密钥的词典查询都不执行。改为词典路径只 `loadConfig` 不校验，AI 兜底前才 `ensureConfig`。
2. **设置表单未填充导致保存覆盖磁盘配置**：启动时 `ensureConfig` 抛错则 `fillSettings` 不执行，表单停留 HTML 默认值；此后任何一次保存把 `dictPath` 等字段写成默认值（实测磁盘词典路径被清空）。改为 `ensureConfig` 校验失败也先把读到的配置记入 `cfg`，`fillSettings` 直接读 `cfg.engines[0]`，启动 catch 分支也填充表单。

## 十二、监听 30 分钟空闲自动暂停（2026-11-11）

需求：30 分钟内没有监听到任何文本剪贴板内容就自动关掉监听，后续使用需再次手动打开。本轮不打包发布。

**实现**（仅前端 `src/main.ts`，Rust 不动）：`WATCH_IDLE_MS = 30 * 60 * 1000`；`armIdleTimer()` 在监听开启时挂计时，到期走与手动暂停完全相同的 `setWatch(false)`（界面开关、`set_paused`、`wb_watch` 持久化一致，重启后保持暂停），并弹提示「30 分钟无文本，监听已自动暂停」。`clipboard-changed` 入口收到任何非空文本即重置计时（含超上限被跳过、重复文本）；手动重开重新计时。

**非文本内容**：Rust 只读 `CF_UNICODETEXT`（`IsClipboardFormatAvailable` 先判格式），文件/图片等不产生事件，不触发翻译也不重置计时。

**验证**：临时把时限缩到 8 秒，dev 真实窗口 + CDP（`tests/idle-watch.mjs`）**5/5**，验证后恢复 30 分钟：

| 用例 | 结果 |
|---|---|
| I1 无活动自动暂停（状态/两开关/localStorage=0/提示文案） | ✓ 7849ms 触发 |
| I2 暂停时复制文本不翻译 | ✓ |
| I3 手动重开 + 复制 apple 出词典卡；复制后 5.5s 仍监听（计时已重置），复制后 8513ms 再自动暂停 | ✓ |
| I4 再次暂停后复制不翻译 | ✓ |
| I5 复制文件到剪贴板：不翻译、不重置计时，7774ms 后照常自动暂停 | ✓ |

截图 `tests/shot-idle-autopause.png`：开关灰、提示条可见。离线回归：timeout 11/11、payload 15/15、word 25/25；tsc、vite build 通过。

## 十三、模型精简 + 双模型设置（2026-11-11）

需求：句子翻译只保留 `hy-mt2-lite` / `hy-mt2-pro` / `hy-mt2-plus` / `deepseek-v4.1-flash-1017` 四个（下架 `hy4` / `glm-5.3-flash`）；设置页「模型」改名「长文本翻译模型」，下方新增「单词详解模型」，默认 `deepseek-v4.1-flash-1017`。本轮不打包发布。

**实现**：

| 位置 | 改动 |
|---|---|
| `src/config.ts` | `MODEL_CHOICES` 四模型；`MODEL_TIMEOUT_MS` 同步删档；新增 `DEFAULT_WORD_MODEL` / `wordModelOf()`（非法值回退默认）；`AppConfig` / `SettingsPatch` 加 `wordModel` |
| `src-tauri/src/config.rs` | `ROOT_KEYS` 白名单加 `wordModel`；单测补断言 |
| `src/adapters/hy.ts` | 删 hy4 的 `thinking` / `max_tokens 2048` 死分支；四模型共用一条骨架 |
| `src/adapters/word.ts` | `aiWordLookup` 增加 model 参数（默认 deepseek），超时按所选模型取档 |
| `src/main.ts` | 新增 `wordModelSel`（填充 / 保存 / 双语文案 / aria）；`tryWordFlow` 与缓存写入用 `wordModelOf`；词典卡底栏显示实际详解模型；`ensureConfig` 把已下架模型名归一化为默认 |
| `index.html` | 连接组：长文本翻译模型行 + 单词详解模型行 + 降级提示 |

**离线回归**：payload **15/15**、timeout **14/14**（含 wordModel 回退 4 项）、word **26/26**、Rust **8/8**（1 联网探针忽略）；tsc、vite build 通过。

**真实 API 实测**：`tests/live.mjs` 四模型 × 3 类文本 **12/12** 全部 `200 / finish=stop`；`tests/timeout-live.mjs` 1950 字符 **4/4**（pro 2.7s / plus 3.1s / lite 1.3s / deepseek 8.9s）。首轮 plus 遇平台 429 限流（此前连发 12 请求），重跑恢复，非代码问题。

**真实窗口端到端（CDP，16/16）**：

| 用例 | 结果 |
|---|---|
| E1–E3 英句 / 中句 / 单词 model 词典卡 | ✓ |
| E4 设置页开关 + 词典状态 | ✓ |
| E5 长文本下拉恰好 4 选项（无 hy4 / glm） | ✓ |
| E10 标签「长文本翻译模型」「单词详解模型」；单词下拉 4 选项、默认 deepseek；降级提示 | ✓ |
| E6 切 deepseek → 底栏「由 deepseek-v4.1-flash-1017 翻译」+ 正常译文 | ✓ |
| E7 恢复原引擎 → 底栏与译文正常 | ✓ |
| E11 单词模型改选 hy-mt2-lite → 磁盘 `wordModel` 落盘 → 还原 | ✓ |
| E8 / W1 / W5 / W4 复制、apple 卡、释义复制、befallen 原形 | ✓ |
| W2 / W3 skibidi AI 卡与缓存（底栏「由 deepseek-v4.1-flash-1017 详解」） | ✓ |
| E9 结束后磁盘两个模型字段均还原 | ✓ |

**非默认单词模型探针**（`tests/word-model-probe.mjs`）：单词模型改选 `hy-mt2-lite` 后查词典未收录词 `zorbqux`，**1.2s 出合法词典卡**，底栏「由 hy-mt2-lite 详解」——hy-mt2 系列也能走 JSON 兜底，失败仍静默降级；随后还原 deepseek 并核对磁盘。（**已被第十五节取代**：hy-mt2 不支持结构化输出，单词模型固定 deepseek，探针脚本已删除、结果留档。）

**截图** `tests/shot-model-settings.png`：连接组两行模型选择器与提示文案，已亲眼确认。

**配置迁移**：dev 配置原残留 `model: "hy4"`，启动归一化为 `hy-mt2-plus`，经设置保存路径写回磁盘；`wordModel` 新键落盘为默认 deepseek。发布版 `E:\译笺1.0` 本轮未动。

## 十四、移除单词详解开关与旧配置兼容（2026-11-11）

需求：软件尚未正式发布，不做旧配置兼容；单词详解去掉设置页开关，命中单词即走详解（常开）。本轮不打包发布。

**实现**：

| 位置 | 改动 |
|---|---|
| `src/main.ts` | 删 `ensureConfig` 的下架模型归一化循环；删 `dictEnabled` 门禁、`dictToggle`/`dictState` 元素引用、`setDictToggle`/`dictOn`、保存 patch 的 `dictEnabled`、i18n `dictLabel`、开关事件监听 |
| `index.html` | 删开关行；保留详解提示、词典路径、词典状态 |
| `src/config.ts` | 删 `dictEnabled`/`relatedEnabled` 字段与 `dictEnabledOf`/`relatedEnabledOf` |
| `src-tauri/src/config.rs` | `ROOT_KEYS` 移除 `dictEnabled`/`relatedEnabled`；单测改为断言白名单**拒绝** `dictEnabled` |
| 配置文件 | `config.local.example.json` 与 dev `config.local.json` 删 `dictEnabled` 行；示例补 `wordModel` |
| `tests/e2e.mjs` | E4 改断言开关不存在、详解提示与词典状态仍在 |

**离线回归**：payload **15/15**、word **26/26**、timeout **14/14**、Rust **8/8**；tsc、vite build 通过。

**真实窗口端到端 16/16**：E4 开关存在=false、词典状态「词典已加载 · 约 3,402,564 词条 · 变形反查已就绪」；W1–W4 无开关仍出词典卡 / 原形行；W2/W3 AI 卡与缓存正常；E9 磁盘模型字段还原。

**截图** `tests/shot-settings-no-toggle.png` 与 `tests/shot-settings-no-toggle-bottom.png`：行为组长度上限提示后直接接详解提示（无开关行），底部词典路径 / 词典状态 / 相关词条占位齐全，已亲眼确认。

**密钥扫描**：e2e / word-model-probe / live / timeout-live 四个结果文件均不含密钥。

**缓存现状**：`word_cache.db`（SQLite，配置文件同目录）当前 12,288 字节、2 条（skibidi、zorbqux），单条 entry 平均约 312 字节；表 `ai_cache(word PRIMARY KEY, entry, model, created_at)`，只写 AI 兜底校验通过的词典卡，无上限、无 LRU、无过期。

**清理**：dev 进程与 `.tmp-wv-model` 已清；发布版 `E:\译笺1.0` 未动（进程存活）。

---

## 十五、单词模型固定 + 上限 2000 + 默认 pro（2026-11-11）

需求：① 单词详解只允许 `deepseek-v4.1-flash-1017`（hy-mt2 三个不支持结构化输出），移除设置页单词模型选择器；② 长度上限 200–2000 可调、最长 2000、初次默认 2000；③ 长文本翻译模型初次默认 `hy-mt2-pro`。本轮不打包发布。

**实现**：

| 位置 | 改动 |
|---|---|
| `src/config.ts` | `DEFAULT_MODEL="hy-mt2-pro"`；`DEFAULT_WORD_MODEL` 为固定常量；`maxCharsOf` clamp 200–2000；删 `wordModelOf` 与 `AppConfig`/`SettingsPatch` 的 `wordModel` |
| `src/adapters/word.ts` | `buildWordPayload(word)` 单参、`model` 恒为 `WORD_FALLBACK_MODEL`；`aiWordLookup(engine, word, fallbackTimeoutMs)` 三参 |
| `src/main.ts` | 删 `wordModelSel` 元素/选项/aria/监听、i18n `wordModelLabel`/`wordModelHint`、`persistNow` 的 `wordModel`；`limitInput` clamp 2000；词典卡底栏与缓存 `model` 用 `WORD_FALLBACK_MODEL` |
| `index.html` | 删单词模型行；`limitInput max="2000"`；`limitHint`/`dictHint` 新文案 |
| `src-tauri/src/config.rs` | `ROOT_KEYS=["timeoutMs","maxChars","dictPath"]`；单测断言白名单拒绝 `wordModel`/`dictEnabled` |
| 配置文件 | example 与 dev 删 `wordModel`；example `model="hy-mt2-pro"` |
| `tests/` | timeout 改 13 项、word 改 25 项、e2e 的 E10/E11/E9 改断言；删 `word-model-probe.mjs` |

**离线回归**：payload **15/15**、word **25/25**、timeout **13/13**、Rust **8/8**（1 联网探针 ignored）；tsc 0 错、vite build 通过。

**真实窗口端到端 16/16**：E10 单词选择器存在=false、详解提示含固定 deepseek 与「降级」、上限提示「可调 200–2000，默认 2000」；E11 填 5000 → 显示与落盘均夹到 2000 → 还原；E9 模型与上限还原（hy-mt2-pro/2000）；W1–W5 词典卡 / 原形 / AI 卡 / 缓存 / 复制正常。

**截图** `tests/shot-settings-no-toggle.png` 与 `-bottom.png`：连接组仅一个「长文本翻译模型」下拉（hy-mt2-pro），无单词模型下拉、无详解开关；行为组上限 2000 + 200–2000 提示 + 固定 deepseek 详解提示；底部相关词条占位与外观组齐全。已亲眼确认。

**密钥扫描**：e2e / live / timeout-live / release-smoke / word-model-probe 五个结果文件均不含密钥。

**说明**：现有 dev `config.local.json` 的 `model` 当前为 `hy-mt2-pro`、`maxChars` 2000；「初次默认 pro」只约束新装与缺省回退，不强制改写用户已选模型。第十三、十四节的双模型 / 探针记录为历史，已被本节取代。

---

## 十六、体验优化（2026-11-11）

需求（用户点单）：① 加载进度感；② 错误态只加提示文字、**不做跳转按钮**；③ 设置页删「相关词条」占位行 + 外观组折叠；④ 窗口位置/大小记忆；⑤ 变形词原形 chip 统一；⑥ 本地翻译历史；⑦ 全局热键 `Ctrl+Alt+T`；⑧ 单词缓存统计 + 清空；⑨ 生词本收藏 + 导出 CSV/Anki；⑩ 开机自启（设置页、**默认关**）。**明确不做**：小项（复制原文/合并背景与多巴胺）、错误态跳转按钮、限流/超时自动换模型重试、划词/截图 OCR。本轮不打包发布。

**实现**：

| 位置 | 改动 |
|---|---|
| `src-tauri/src/store.rs`（新） | `library.db`：历史 cap 100（超出淘汰最旧）+ 生词本收藏；9 个 IPC：`history_add/list/clear`、`favorite_put/remove/list`、`favorites_export`、`cache_stats/clear` |
| `src-tauri/src/system.rs`（新） | 4 个 IPC：`hotkey_set/available`（`RegisterHotKey` + 独立线程 `GetMessageW` 收 `WM_HOTKEY`，`AtomicBool` 开关/注册态）、`autostart_get/set`（HKCU Run 注册表，值名 `YiJianClipboardTranslator`，注册表为唯一事实源） |
| `src-tauri/src/lib.rs` | `restore_window_state` 启动校验 w/h 后 `set_size`+`set_position`；`Moved/Resized` → 500ms 防抖落盘 `window-state.json`（逻辑像素）；`spawn_hotkey`；注册 13 个新命令（合计 30） |
| `src-tauri/src/dict.rs` | 词典直接命中也返回 `lemma`（`Option`→`null`），与反查/AI 路径统一原形 chip |
| `src/main.ts` | 历史/生词本同窗视图、词典卡星标、加载态计时（每秒）+ 模型提示 + deepseek 慢标注、错误态提示文案、缓存统计/清空、热键/自启 UI 与初始化、导出、`recordWordHistory`/`recordTextHistory` |
| `index.html` | 工具条书本按钮；行为组删 related 行、加缓存/热键/自启三行；外观组改 `<details>` 默认折叠；新增 `libraryView`（历史/生词本标签 + 清空 + 导出） |
| `src/styles.css` | 折叠组、库标签/行/空态、词典卡星标（`.dict-fav.on` 金色）样式 |

**离线回归**：payload **15/15**、word **25/25**、timeout **13/13**、Rust **8 passed / 1 ignored**（联网探针）；`tsc --noEmit` 0 错、`vite build` 通过（JS 42.16 kB / CSS 13.42 kB）。

**真实窗口端到端 21/21**（`tests/e2e.mjs`，CDP 9222，逐条实测输出）：

- E4：相关词条行存在=**false**、缓存行=「单词缓存」、自启=**false**、外观折叠=**true**；词典「已加载 · 约 3,402,564 词条 · 变形反查已就绪」。
- W4：`befallen` → 原形行=**befall**、词头=befallen（证明词典直接命中也带 lemma，原形 chip 统一）。
- L1：历史面板可见、tab=history、行数=**10**；L2：点行回看原文=skibidi；L3：星标 初=false→一次=true→二次=false（自恢复）。
- L4：缓存=「**2 条 · 12.0 KB**」、热键禁用=false、提示=Ctrl+Alt+T、自启=false、折叠=true；L5：热键 关=false→开=true（自恢复）。
- E9：结束后 `model=hy-mt2-pro`、`maxChars=2000` 与测试前一致（配置未被改动）。

**可视化 + 功能验证**（`tests/verify-d.mjs`，CDP 截图 + 断言，跑完自恢复）：错误态用临时坏 baseUrl `http://127.0.0.1:9/v1` 触发，提示文案正确、无跳转按钮，`try/finally` 还原真实地址；apple 星标 off/on；生词本导出 CSV/Anki 内容校验后删除测试文件；新词 `zorpquake` 抓加载帧（「正在翻译… · deepseek-v4.1-flash-1017 / 已用 0 秒 / 单词详解由 deepseek 生成，通常需数秒…」）；缓存 3→0→2 还原；favorites 归 0。

**窗口记忆真重启实测**：拖拽缩放至 430×540 → `window-state.json` 落盘 `{w:430,h:540,x:2184,y:832}` → 重启 dev → `GetWindowRect` 读物理矩形 **2184,832,2614,1372（W=430 H=540）完全一致** → 健康探针 hotkey=true / autostart=false / cache=2 → 重置 360×560 留给用户。

**截图（10 张，均已亲眼确认，用户主题古墨绿 #254B3B 深色）** `tests/shots/`：`d-settings-top`（连接组）、`d-settings-bottom`（缓存/热键/自启默认关）、`d-settings-appearance`（外观展开）、`d-error`（错误提示无按钮）、`d-loading`（模型+秒数+慢提示）、`d-word-star-off`/`-on`（词典卡星标）、`d-library-fav`（生词本+导出）、`d-library-history`（历史行）、`d-cache-cleared`（缓存 0 条）。

**密钥扫描**：交付前对 `config.local.json` 真实 apiKey 做 `includes()` 扫描，本节及 README / HANDOFF / 各结果文件均不含密钥（只打印 clean / KEY_LEAK）。

**说明**：现有 dev 配置 `model=hy-mt2-pro`、`maxChars=2000`、`baseUrl=https://tokenhub.tencentmaas.com/v1` 均已还原；`window-state.json` 重置 360×560；缓存 2 条（skibidi、zorbqux）、favorites=0。第十五节「16/16」为历史，e2e 现为 21 场景。

---

## 十七、改名译雀/Sparrow + 8 款配色方案（2026-11-12）

需求（用户点单）：① 软件改名「译雀 / Sparrow」，设置页界面语言中英切换时**左上角品牌名同步切换**；② 用已认可的 8 款配色**替换**原「背景底色 + 多巴胺系列」，**默认雾隐**。本轮不打包发布。原型 `prototypes/palette-studio.html` 先经用户认可后才落地。

**实现**：

| 位置 | 改动 |
|---|---|
| `src/main.ts` | i18n 增 `brand`（译雀/Sparrow）、`themeLabel` 改「配色方案/Color scheme」，删 customLabel/dopamineLabel/dopaPick/customTheme；`DOPAMINE`(27 色) 与单色派生 `applyTheme/normalizeHex/mixHex` 整体替换为 `SCHEMES`(8 套令牌)+`SCHEME_VARS`+`applyScheme/readScheme`（含 WCAG `textOn` 求 `--accent-fg`）；设置页改建 2 列 `.scheme-tile` 卡片；`applyLang` 同步品牌/标题/浅深标记；删 dopa/swatch/hex/colorPicker 全部引用与监听 |
| `index.html` | `<title>` 与左上 `brand-top`(id=brandTop) 改译雀；删「背景底色」「多巴胺系列」两行，换单一「配色方案」行 + `#schemeGrid` |
| `src/styles.css` | `.win` 默认变量改雾隐全套令牌并新增 `--surface-2/--accent/--accent-fg/--accent-soft/--accent-2/--success/--warning/--info`；强调色路由到 `.sw.on`/`.icon.pinned`/`.source` 左色条/`.seg button.on`/`.inp:focus`/`.dict-chip`/`.d-pos`/`.dict-fav.on`；删 `.swatch/.color-pick/.hex-input/.dopa-*`；新增 `.scheme-grid/.scheme-tile/...` |
| `src-tauri/tauri.conf.json` | productName / windows.title 改译雀 |
| `src-tauri/src/lib.rs` | 托盘菜单「显示译笺」→「显示译雀」 |
| `tests/e2e.mjs` | state 增品牌/标题/配色字段；新增 T1–T3（8 卡默认雾隐+旧控件移除、品牌/标题/标签/浅深随语言、点选墨玉→变量记忆同步再还原） |

**8 款令牌**（与原型逐字一致）：雾隐 Brume / 黛山 Slate / 陶土 Clay / 苔庭 Moss（浅·莫兰迪/类莫兰迪）、素笺 Ivory（浅·高级感）、墨玉 Onyx / 暮金 Dusk / 霁青 Celadon（深·高级感）。`wb_theme` 现存方案 id（旧 hex 值不匹配时回退雾隐）。

**离线**：`tsc && vite build` 通过（JS 42.08 kB / CSS 13.34 kB），0 类型错。

**真实窗口端到端 24/24**（`tests/e2e.mjs`，CDP 9222）：原 E/W/L 全过 + 新增 T1（卡片=8/选中=brume/记忆=brume/标签=配色方案/旧控件=false/底色=#E7E3DA）、T2（en 品牌=Sparrow/标题=Sparrow/标签=Color scheme/标记 Light·Dark；zh 品牌=译雀）、T3（onyx 底色=#1E2422/强调=#86B7A6/记忆=onyx → 还原 brume/#E7E3DA）；E9 配置 model/maxChars 未被改动。

**真窗口可视化验证**（`prototypes/verify-app.mjs`，连运行中应用 CDP 截图 + computed style，跑完自恢复中文+雾隐）：品牌 译雀↔Sparrow 与标题联动；8 款逐一点选 `--bg/--accent/--accent-fg` 与选中态/记忆同步；强调色实测路由到原文左色条/分段选中/开关轨（brume rgb(124,138,110)、onyx rgb(134,183,166)）；浅深标记 浅/深↔Light/Dark；设置页无横向溢出（scrollW=clientW=360、gridRight=344、tileOverflow=[]）。截图 `prototypes/shots-app/`：00/07 译文雾隐、01 设置中文、02 设置英文(Sparrow)、04-clay/onyx/dusk/celadon、05 onyx 英文，均已亲眼确认（深色方案卡片与文字对比正常）。唯一 console 404 为浏览器自动请求 /favicon.ico（无 favicon 链接，历史既有，非本轮引入）。

**密钥扫描**：本节与 README / HANDOFF / e2e-results / verify-app-results 均不含真实 apiKey（交付前 grep 确认）。

**说明**：词典真实路径 `E:\译笺词库\ecdict.db` 与历史发布目录 `E:\译笺1.0` 为磁盘事实，**不随改名改动**；原型/旧 preview 文件保留历史名。dev 配置与窗口状态未被本轮改动。

---

## 十八、打包发布 译雀 1.0 到 E:\译笺1.0（2026-11-12）

需求（用户点单）：把软件打包发布到 `E:\译笺1.0`，**先删除该目录旧文件**。本轮**正式打包**（推翻此前「不打包」的延续指示）。

**构建**：`npm run tauri build -- --no-bundle`，release profile（LTO）2m22s，产物 `src-tauri/target/release/clipboard-translator.exe`（6,824,960 字节）。前端 `tsc && vite build` 0 错（JS 42.08 kB / CSS 13.34 kB）。

**交付**（先删旧再放新）：删除旧 `译笺.exe` / 旧 `config.local.json` / `word_cache.db` / 旧 `使用说明.txt`；拷入 **译雀.exe** + **无密钥 config.local.json**（apiKey 留空，baseUrl / dictPath=E:\译笺词库\ecdict.db / 默认 pro / maxChars 2000 保留）+ 重写 `使用说明.txt`（译雀 1.0、四模型、改名+8 配色、热键/自启/历史生词本）。**注意**：旧发布目录的 config 实际含真实密钥（与旧说明文字不符），已随删除清除；新配置确认无密钥。

**发布版冒烟 4/4**（`tests/release-smoke.mjs`，带 CDP 9222 启动 译雀.exe，url=tauri.localhost 证明是 release 而非 dev）：S1 apple 词典卡（无密钥可用，chips 柯林斯3星/牛津/中考/高考）、S2 model 词典卡、S3 词典已加载·约3,402,564词条、S4 保存设置不覆盖 dictPath。

**发布版 UI 验证 5/5**（`tests/release-verify.mjs`，截图 `tests/shots-release/`，均已亲眼确认）：R1 默认品牌/标题=译雀+雾隐 brume(#E7E3DA)+8卡+apple词典卡；R2 设置页配色方案标签+8卡+5浅3深+无密钥；R3 英文品牌/标题=Sparrow+Color scheme+Light/Dark；R4 墨玉 onyx(#1E2422/#86B7A6)选中与记忆；R5 还原雾隐。截图 01 主视图雾隐、02 设置8卡、03 英文Sparrow、04 onyx深色、05 还原。

**收尾**：测试实例已退出；config 重置为无密钥默认（model pro）；删除测试产生的 library.db；交付目录仅 {译雀.exe, config.local.json, 使用说明.txt}。

**密钥扫描**：对交付目录 config / 使用说明 / **译雀.exe 二进制** 及 release-smoke-results / release-verify-results 做字节级 includes 扫描，全部 clean（keys_checked=1）。

**说明**：词典 `E:\译笺词库\ecdict.db` 在发布目录之外，不受删旧影响；dev 配置未被本轮改动。

---

## 十九、单实例（仅发布版）+ 首启居中 + 图标候选（2026-11-12，不发布）

需求（用户点单）：① 设计几个图标方案供选择（不落地）；② 发布版不可多开（后台仅一个），dev/调试可多开；③ 初次打开默认屏幕居中。**本轮不打包发布**，等用户下令再发布。

**实现**：

| 位置 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | 新增 `tauri-plugin-single-instance = "2"`（实测 v2.5.5） |
| `src-tauri/src/lib.rs` | `#[cfg(not(debug_assertions))]` 注册 single-instance（回调 show/unminimize/set_focus 主窗）；首启无存档 fallback 由「右下角」改为 `window.center()`；清理 unused imports |
| `src-tauri/tauri.conf.json` | `windows[0].center: true` |
| `prototypes/icon-studio.html`（新） | 六款 SVG 图标候选 + 浅/深底 + 16–64px 尺寸梯；仅原型 |
| `tests/win-info.ps1`（新） | 读进程数 + GetWindowRect + 屏幕中心，供居中/单实例实测 |

**实测**（本地构建，不交付）：
- release（`tauri build --no-bundle`）：隔离目录（无密钥 config、无 window-state）启动实例 1 → 再启动实例 2 → **进程数=1**（二次启动转发并退出）；首启窗口 rect=1100,425,1460,985（360×560），winCenter=(1280,705) vs screenCenter=(1280,720)，dx=0 / dy=-15（任务栏工作区中心）→ **居中成立**。
- debug（`cargo build`）：隔离目录双开（独立 WebView2 profile）→ **进程数=2** → dev 可多开成立。
- 测试实例与 `.tmp-single` / `.tmp-multi` 已清理。

**图标候选**：A 雀影 Perch / B 折雀 Origami / C 语窗 Bubble / D 翼书 Wing S / E 笺雀 Clipboard / F 圆雀 Roundel；截图 `prototypes/shots-icons/icon-studio-full.png` 已亲眼确认；推荐 C（翻译气泡+负空间雀）。**待用户选定**后才导出 PNG/ICO 替换 `src-tauri/icons`。

**说明**：`E:\译笺1.0` 现有 exe 为第十八节产物，**尚不含**单实例/居中/新图标；待用户下令发布时重新构建交付。dev 配置未被本轮改动。

---

## 二十、图标 F 浅色落地 + PRD（2026-11-12，不发布）

**用户选定**：方案 F「圆雀 Roundel」**浅色款**（圆环徽章 + 负空间麻雀，雾隐浅底 #F1EDE5 / 强调 #7C8A6E / 描边 #D6CFC1）。

**落地链路**：
| 步骤 | 产物 | 验证 |
|---|---|---|
| 提取 F 浅色 SVG | `prototypes/icon-f-light.svg`（1024×1024） | 与原型几何/配色一致 |
| 浏览器 canvas 渲染 | `prototypes/icon-f-light-1024.png`（RGBA 1024×1024） | 目视确认圆环+雀+负空间翅 |
| `tauri icon` 导出 | `src-tauri/icons/*`（32/64/128/128@2x/icon.png/icon.ico/icon.icns/Square*） | 128px、32px 目视确认 |
| 清理移动端冗余 | 删 `icons/ios/`、`icons/android/`（Windows-only 不用） | 目录仅余桌面格式 |
| 强制 winres 重跑 | `touch src-tauri/tauri.conf.json` 后 `tauri build --no-bundle` | resource.lib 02:57 重建、exe 02:59 重链 |

**winres 坑（重要）**：`tauri_build` build script 的 `rerun-if-changed` 仅含 `capabilities` 与 `tauri.conf.json`，**不跟踪 icons**。首次只换图标重构建后，`Icon.ExtractAssociatedIcon(exe)` 仍返回旧默认图标（resource.lib 停留旧时间戳）。`touch tauri.conf.json` 强制重跑 build script 后，exe 内嵌图标才更新为 F 浅色。另：`System.Drawing` 解 PNG 压缩的 256 帧 ICO 会花屏，**不可用作验证**；用 `ExtractAssociatedIcon`（取 BMP 小帧）或浏览器解码。

**真窗口/资源实测**（本地构建，不交付）：
- 重建后 `ExtractAssociatedIcon(release exe)` → **F 浅色圆雀**（`tests/shots-icon/exe-icon.png` 目视确认）。
- 隔离目录启动 release → 真 OS 截屏任务栏活动按钮 = **浅底+绿圆环**（`tests/shots-icon/taskbar.png` 目视确认）；托盘共用 `default_window_icon`（同资产，位于通知区溢出）。
- 单实例回归：release 双开 → **进程数=1**（转发并退出）。
- 测试实例与 `.tmp-icon` 已清理。

**PRD**：新增 `PRD.md`（v1.0 需求基线），含 §0 密钥红线、定位/目标与非目标、用户故事、FR/NFR、接口与数据（冻结请求体）、验收映射、已知边界、版本历史；grep 确认不含真实 Key。

**说明**：本轮**不打包发布**；`E:\译笺1.0` 仍为第十八节产物，待用户下令发布时带上单实例/居中/F 图标重新交付。GitHub 上传整理方案已口头给出（补 .gitignore / 清理残留 / 先审查再首提交 / 空仓库推送），**未实际执行**。

## 二十一、原文框手动输入（保留复制即译、无互斥）（2026-11-12，不发布）

**需求与方案**：用户点单「在原文框开放手动输入英文单词或内容」。经讨论**否决**互斥/模式切换/焦点抑制，定为**附加通道**：复制即译常开，原文框改可编辑 `textarea` + 「翻译」按钮，`Enter` 翻译 / `Shift+Enter` 换行，复用同一条翻译管线。

**实现**（仅前端，未动 Rust / IPC / POST 模板）：
| 位置 | 改动 |
|---|---|
| `index.html` | 原文 `div`→`textarea`(rows=2、spellcheck off、本地化 placeholder)；「原文」标签行加「翻译」图标按钮 `btnTranslate` |
| `src/main.ts` | `sourceText` 改 `HTMLTextAreaElement`；回看写入 `.textContent`→`.value`；`runTranslation` 移除原文框写入与 140 截断（改由调用方填充）；`handleClipboard` 合流回调填 `value`；新增 `triggerManual` + Enter/按钮监听（`isComposing`/`shiftKey` 守卫）；i18n 增 `srcPlaceholder`/`translate`；`applyLang` 本地化 placeholder/aria |
| `src/styles.css` | `textarea.source-text` 重置（透明底/无边框/不可拖拽/继承字体）、`::placeholder`、`.source:focus-within` 细描边、`.translate-at-label` |
| `tests/e2e.mjs` | stateExpr 的 `src` 改读 `.value`（适配 textarea） |
| `tests/manual-e2e.mjs`（新） | M0–M8 真实窗口端到端 + 截图 |

**离线回归**：`tsc --noEmit` 0 错；`vite build` 成功；`payload` 15/15、`word` 25/25、`timeout` 13/13（POST 模板逐字未变）。

**真实窗口实测**（dev + CDP 9222、隔离 WebView2 profile）：`manual-e2e.mjs` **10/10**：
- M0 textarea+翻译按钮+占位提示；M1 手动 `apple`→本地词典卡；M2 手动句+Enter→译文；M3 `Shift+Enter` 换行(`"line one\n"`)且不翻译；M4 空白忽略；M8 输入法组词 Enter 不触发不拦截；M5 **聚焦原文框时复制新文本仍自动翻译并覆盖草稿（无抑制）**；M6a 超上限(2233>2000)跳过卡、M6b「仍要翻译」正常；M7 手动写入历史。
- 截图 `tests/shots-manual/{m0-empty,m1-word-dict,m2-sentence,m5-clipboard-focused,m6-skip,m7-history}.png` 目视确认：原文框可编辑 + 标签行翻译箭头 + 词典卡/译文/跳过卡渲染正常、无裁切/重叠。

**全量 e2e 说明**：本轮 `e2e.mjs` **19/24**，5 项红均与本次改动无关：E4/L4/L5 因**用户发布版译雀正在托盘运行、占用 `Ctrl+Alt+T`**，dev 实例热键注册失败（环境占用，非回归）；E7 为同文重复制不产生剪贴板变化事件、W3 为缓存/词典时序抖动（已知）。剪贴板核心(E1/E2/E3/E6/E8)、单词(W1/W4/W5)、历史(L1/L2)、配色/品牌(T1–T3)、配置未改动(E9) 全过。

**PRD/文档同步**：PRD 增 §4.8 手动输入 FR（无互斥）+ G7/US9/§7/§8/§9/§10；README/HANDOFF 同步；grep 确认 PRD 与本报告不再以「倒推」表述。

**说明**：本轮**不打包发布**；`E:\译笺1.0` 仍为旧产物，待用户下令发布时带上手动输入/单实例/居中/F 图标重新交付。

## 二十二、竞态防护复核（requestSeq，2026-11-12，不发布）

**用户提问**：前后翻译两个文本、返回速度不同，如何保证界面是最新一次的译文？是否已有防护？

**结论：已实现**。机制为递增编号 `requestSeq`（`src/main.ts`）：`runTranslation` 开头 `const seq = ++requestSeq`；每个异步恢复点先比对 `seq !== requestSeq` 即 return——句子 `translate` 返回后与 catch、单词 `tryWordFlow` 的 `dict_lookup` 返回后 / AI 兜底返回后 / 降级路径。被顶替的旧响应**不渲染、不写历史、不写缓存**；加载计时器随 `clearBody()` 清除，不会串台。

**真实窗口实测**（dev + CDP 9222）：新增 `tests/race-e2e.mjs` **4/4**：
- R1a 慢句先发+快词后发 → 先显示最新快词词典卡；R1b 再等 7s 让慢句真实响应到达 → 界面**仍是快词**（迟到响应被丢弃，截图 `tests/shots-race/r1-stale-discarded.png` 目视确认）。
- R2 被顶替的慢句**不写入历史**。
- R3 快词先发+慢句后发（最新为慢句）→ 最终显示慢句译文（`r3-latest-slow-wins.png`）。

**文档**：PRD 增 FR1.10（竞态防护）+ §8 验收行；HANDOFF §4.2 与测试清单同步。另附交互演示（requestSeq 时间轴，可开关防护对比事故态）。

## 二十三、打包发布 译雀 1.0 到 E:\译雀1.0（2026-11-12，正式打包）

**需求（用户点单）**：把当前这版打包发布到 `E:\译雀1.0`，发布前先删除该目录旧文件。目录已由用户从 `译笺1.0` 改名为 `译雀1.0`。经询问，用户选择**全部清空（先备份）**。

**备份**：清空前把使用数据 `library.db`（历史+生词本）、`window-state.json`（窗口位置）复制到 `E:\译雀1.0-数据备份\`（已核对字节数一致）。

**构建**：`touch src-tauri/tauri.conf.json`（保证 winres 图标资源新鲜）→ `npm run tauri build -- --no-bundle`（2m27s）→ `src-tauri/target/release/clipboard-translator.exe`（6,830,592 字节）。

**交付**：清空 `E:\译雀1.0` 旧文件（译雀.exe/config/使用说明/library.db/window-state）→ 交付新 `译雀.exe` + 无密钥 `config.local.json`(apiKey 空、model hy-mt2-pro、dictPath 不变) + 更新版 `使用说明.txt`（新增手动输入/单实例/居中说明）。冒烟产生的测试数据（library.db/word_cache.db/window-state.json）测后清除、config 复位，交付包为全新安装态。

**真实窗口冒烟**（带 CDP 9222 启动 `E:\译雀1.0\译雀.exe`，url=tauri.localhost 证明 release）：`tests/release-smoke.mjs` **4/4**（S1 apple 词典卡无密钥可用、S2 model 词典卡、S3 词典已加载·约340万词条、S4 保存不覆盖 dictPath）。另实测**发布版手动输入**：原文框敲 apple + Enter → 词典卡，截图 `tests/shots-release/manual-release.png` 目视确认。

**冒烟脚本适配（本轮修复的两处环境/状态问题，非功能回归）**：① 原文框改 textarea 后 `src` 读 `.value`；② 配置路径改 `译雀1.0`；③ 前置恢复监听——旧 WebView2 profile 残留「30 分钟空闲自动暂停」的 `wb_watch=0` 会使剪贴板入口 return（首跑 S1/S2 红的原因）；④ S3 改「仅当设置页隐藏才点击」，避免上一轮遗留设置页打开时点击变成关闭（次跑 S3 红的原因）。

**密钥扫描**：交付包 config/使用说明/exe 二进制均不含真实 Key → **SECRET_SCAN_CLEAN**。

**文档**：README/HANDOFF/PRD 的发布目录与状态更新为 `E:\译雀1.0`（含手动输入/单实例/居中/F 图标）；PRD §10 增发布条目。历史章节中的 `译笺1.0` 为当时磁盘事实，保留不改。

**文件夹图标「没变」的澄清与处理**：用户反馈资源管理器里 `译雀.exe` 图标仍是旧的（运行时图标已是新）。实测 `Icon.ExtractAssociatedIcon(交付 exe)` 返回 **F 圆雀浅色**（`tests/shots-icon/delivered-exe-icon.png`），证明 exe 内嵌图标正确；旧显示为 **Windows 图标缓存**。先试 `ie4uinit -show` + 关窗重开，用户侧仍异常（磁盘 `iconcache_*.db` 仍持旧条目）。经用户**明确授权**后：结束 explorer.exe → 删除 `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` 与 `%LOCALAPPDATA%\IconCache.db` → 重启资源管理器 → 重开文件夹，放大截图 `tests/shots-icon/folder-icon-after-clear.png` 确认列表显示新 F 图标。**非打包/图标资源问题，无需重新构建。**

## 二十四、源码发布到 GitHub（2026-11-12）

**需求**：整理项目并发布到用户 GitHub。仓库名/可见性经询问定为 `clipboard-translator` / **公开**（账号 `sweetbellpepper`）。

**整理**：补 `.gitignore`（`src-tauri/target/`、`gen/schemas/`、`*.db`、`window-state.json`、`.tmp-*`、`git-history.bundle`、各级截图目录、`tests/*.png`）；`git init -b main`；首提交前对 97 个暂存文件逐一密钥扫描 **clean**；提交 7eee738。二进制图标改为 base64（`tools/assets.b64.json`，18 项 684,287B）+ `tools/restore-icons.mjs` + `package.json` postinstall 自动还原，提交 06b2d92（72 个文本文件入库，图标/截图/数据库/密钥均不入库）。

**推送波折与根因**：① 连接器（MCP）OAuth token 只供 API，不写入 git/GCM，故 `git push` 无凭据；② 本代理 shell 无 `/dev/tty` 且无法弹窗，GCM 各模式（browser/device/--no-ui）均挂起，终端授权无法在沙箱完成；③ 用户在自己终端完成 GCM 授权后，沙箱与用户终端直连 `github.com:443` 均被 reset/超时（`api.github.com` 却 200）→ 网络层阻断 git 主机；④ 发现用户本地代理 `127.0.0.1:7897`，`curl -x` 验证 github.com=200 → `git -c http.proxy=… push` **成功**（main→main）。

**远端校验**（连接器）：`list_commits`=7eee738+06b2d92 与本地一致；`config.local.json` **不存在**（无密钥）；`src-tauri/icons/icon.ico` 不存在（图标走 base64，符合设计）；`tools/` 目录含 `assets.b64.json`(684,287B)+`restore-icons.mjs`(756B)。克隆后 `npm install` 触发 postinstall 还原图标即可构建。

**文档**：README/HANDOFF/PRD 同步 GitHub 地址与发布状态。
