import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { buildTranslators } from "./adapters";
import type { Translator } from "./adapters/types";
import {
  aiWordLookup,
  cardFromDictEntry,
  isSingleEnglishWord,
  WORD_FALLBACK_MODEL,
} from "./adapters/word";
import type { DictLookupReply, RawDictEntry, WordCard } from "./adapters/word";
import {
  loadConfig,
  maxCharsOf,
  saveSettings,
  timeoutOf,
  validateEngine,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_CHOICES,
} from "./config";
import type { AppConfig, SettingsPatch } from "./config";

const MERGE_MS = 100;
const DUP_WINDOW_MS = 1000;
const WATCH_IDLE_MS = 30 * 60 * 1000;
const FS_KEY = "wb_fs";
const THEME_KEY = "wb_theme";

const I = {
  zh: {
    source: "原文", target: "译文", pinLabel: "窗口置顶", direction: "切换中英方向",
    settings: "设置", minimize: "最小化", close: "收进托盘", back: "返回译文", copy: "复制译文",
    watchOn: "监听中 · 点击暂停", watchOff: "已暂停 · 点击恢复",
    watchStateOn: "监听中", watchStateOff: "已暂停",
    settingsTitle: "设置", grpConn: "连接", grpBehav: "行为", grpLook: "外观",
    keyLabel: "API Key", urlLabel: "接口地址", modelLabel: "长文本翻译模型",
    limitHint: "超过上限直接跳过、不发请求；可调 200–2000，默认 2000。",
    keyHint: "密钥只写入本机不入库的 config.local.json，不进浏览器存储、不进构建产物。",
    keySaved: "已保存 · 留空表示不修改", keyEmpty: "请填入 API Key", keyMissing: "尚未填写 API Key，请先填入",
    watchLabel: "剪贴板监听", limitLabel: "长度上限", limitUnit: "字符",
    dictHint: "单个英文单词优先查本地词典（音标、全部词性释义）；未收录时固定由 deepseek-v4.1-flash-1017 详解，失败自动降级为普通翻译。",
    dictPathLabel: "词典路径",
    dictStatusOk: "词典已加载 · 约 {n} 词条",
    dictStatusLemma: " · 变形反查已就绪", dictStatusNoLemma: " · 变形反查未构建（运行 prepare_dict 生成）",
    dictStatusMissing: "未找到词典文件；单词将由 AI 详解并缓存",
    library: "历史与生词本", libClear: "清空当前列表", libCleared: "已清空",
    tabHistory: "历史", tabFav: "生词本", exportCsv: "导出 CSV", exportAnki: "导出 Anki",
    exported: "已导出", libEmptyHistory: "还没有翻译历史", libEmptyFav: "还没有收藏的单词",
    favAdd: "收藏到生词本", favRemove: "取消收藏", favAdded: "已收藏到生词本", favRemoved: "已取消收藏",
    opFail: "操作失败", loadingSlow: "单词详解由 deepseek 生成，通常需数秒…", elapsedUnit: "已用 {n} 秒",
    cacheLabel: "单词缓存", cacheClear: "清空", cacheStatsFmt: "{n} 条 · {size}", cacheCleared: "缓存已清空",
    hotkeyLabel: "全局热键", hotkeyUnavailable: "热键被占用", hotkeyDesc: "在任意界面按下这组键即可唤出 / 隐藏窗口；关闭后不再响应。", autostartLabel: "开机自启",
    autostartOn: "已开启开机自启", autostartOff: "已关闭开机自启", histWord: "词", histText: "句",
    baseLabel: "原形",
    noteDict: "由本地词典提供", noteWordAi: "由 {model} 详解",
    collinsStar: "柯林斯 {n} 星", oxfordWord: "牛津核心词", exampleLabel: "例句",
    langLabel: "界面语言", fsLabel: "字号", themeLabel: "配色方案", brand: "译雀",
    off: "关", on: "开", save: "保存",
    skipTitle: "已跳过本次翻译",
    skipSub: "原文共 {n} 字符，超过上限 {m} 字符。为避免无谓开销，本次没有发送任何请求。",
    force: "仍要翻译",
    loadingHint: "正在翻译…", errorTitle: "请求失败",
    errorSub: "请检查 API Key 与接口地址；402 多为模型未启用，限流或超时可稍后重试", retry: "重试",
    firstRun: "复制任意英文文本试试",
    srcPlaceholder: "复制即译，或在此输入后按 Enter 翻译", translate: "翻译",
    engineNote: "由 {model} 翻译",
    noteDegraded: "词条未生成，已显示普通译文",
    charCount: "原文 {n} 字符 · 译文 {m} 字符",
    copied: "译文已复制", copyFail: "复制失败", saved: "已保存，配置已重新读取",
    saveFail: "保存失败", dirToast: "方向已切换并锁定",
    pinned: "已置顶 · 窗口会停在其他软件上方", unpinned: "已取消置顶",
    watchToastOn: "已恢复监听", watchToastOff: "已暂停监听",
    watchIdle: "30 分钟无文本，监听已自动暂停",
    keyShown: "密钥已显示", keyHidden: "密钥已隐藏",
  },
  en: {
    source: "Original", target: "Translation", pinLabel: "Always on top", direction: "Swap languages",
    settings: "Settings", minimize: "Minimize", close: "Minimize to tray", back: "Back", copy: "Copy translation",
    watchOn: "Watching · click to pause", watchOff: "Paused · click to resume",
    watchStateOn: "Watching", watchStateOff: "Paused",
    settingsTitle: "Settings", grpConn: "Connection", grpBehav: "Behaviour", grpLook: "Appearance",
    keyLabel: "API Key", urlLabel: "Base URL", modelLabel: "Long-text model",
    limitHint: "Longer text is skipped without a request. Range 200-2000, default 2000.",
    keyHint: "The key is written only to the local, git-ignored config.local.json.",
    keySaved: "Saved · leave blank to keep it", keyEmpty: "Paste your API Key", keyMissing: "No API Key saved yet — paste one first",
    watchLabel: "Clipboard watch", limitLabel: "Length limit", limitUnit: "chars",
    dictHint: "A single English word looks up the local dictionary first (IPA, all senses); misses are detailed by deepseek-v4.1-flash-1017, falling back to plain translation on failure.",
    dictPathLabel: "Dictionary path",
    dictStatusOk: "Loaded · about {n} entries",
    dictStatusLemma: " · lemma lookup ready", dictStatusNoLemma: " · lemma table missing (run prepare_dict)",
    dictStatusMissing: "Dictionary file not found; words go to AI and get cached",
    library: "History & words", libClear: "Clear list", libCleared: "Cleared",
    tabHistory: "History", tabFav: "Words", exportCsv: "Export CSV", exportAnki: "Export Anki",
    exported: "Exported", libEmptyHistory: "No translation history yet", libEmptyFav: "No saved words yet",
    favAdd: "Save to words", favRemove: "Remove from words", favAdded: "Saved", favRemoved: "Removed",
    opFail: "Operation failed", loadingSlow: "Word detail by deepseek usually takes a few seconds…", elapsedUnit: "{n}s elapsed",
    cacheLabel: "Word cache", cacheClear: "Clear", cacheStatsFmt: "{n} entries · {size}", cacheCleared: "Cache cleared",
    hotkeyLabel: "Global hotkey", hotkeyUnavailable: "Hotkey in use", hotkeyDesc: "Press this combo anywhere to show / hide the window; off means no response.", autostartLabel: "Launch at startup",
    autostartOn: "Startup enabled", autostartOff: "Startup disabled", histWord: "word", histText: "text",
    baseLabel: "Base form",
    noteDict: "From local dictionary", noteWordAi: "Detailed by {model}",
    collinsStar: "Collins {n} star", oxfordWord: "Oxford core", exampleLabel: "Example",
    langLabel: "Interface language", fsLabel: "Text size", themeLabel: "Color scheme", brand: "Sparrow",
    off: "Off", on: "On", save: "Save",
    skipTitle: "Translation skipped",
    skipSub: "The text is {n} characters, over the {m} limit. No request was sent.",
    force: "Translate anyway",
    loadingHint: "Translating…", errorTitle: "Request failed",
    errorSub: "Check the API Key and base URL. 402 usually means the model is not enabled; retry later if rate-limited or timed out", retry: "Retry",
    firstRun: "Copy any English text to try",
    srcPlaceholder: "Copy to translate, or type here and press Enter", translate: "Translate",
    engineNote: "Translated by {model}",
    noteDegraded: "Word card unavailable · plain translation shown",
    charCount: "Original {n} chars · Translation {m} chars",
    copied: "Translation copied", copyFail: "Copy failed", saved: "Saved, config reloaded",
    saveFail: "Save failed", dirToast: "Direction switched and locked",
    pinned: "Pinned · window stays above other apps", unpinned: "Unpinned",
    watchToastOn: "Watching resumed", watchToastOff: "Watching paused",
    watchIdle: "No text for 30 min · watch auto-paused",
    keyShown: "Key visible", keyHidden: "Key hidden",
  },
};

type SchemeTokens = {
  bg: string; surface: string; surface2: string; fg: string; muted: string;
  border: string; hover: string; accent: string; accentSoft: string; accent2: string;
  success: string; warning: string; danger: string; info: string;
};
type Scheme = { id: string; cn: string; en: string; mode: "浅" | "深"; t: SchemeTokens };

/** 8 款成对配色（莫兰迪 / 类莫兰迪 / 高级感），令牌与已认可的原型逐字一致。默认 brume 雾隐。 */
const SCHEMES: Scheme[] = [
  { id: "brume", cn: "雾隐", en: "Brume", mode: "浅", t: { bg: "#E7E3DA", surface: "#F1EDE5", surface2: "#DED8CC", fg: "#45413A", muted: "#857F72", border: "#D6CFC1", hover: "#E0DACE", accent: "#7C8A6E", accentSoft: "#DDE2D2", accent2: "#B08E88", success: "#6E8B6A", warning: "#C2A15C", danger: "#A56A61", info: "#7E93A0" } },
  { id: "slate", cn: "黛山", en: "Slate", mode: "浅", t: { bg: "#E4E7EA", surface: "#EFF1F3", surface2: "#D6DBE0", fg: "#3C444C", muted: "#78828C", border: "#CCD3D9", hover: "#DCE1E5", accent: "#5F7A8A", accentSoft: "#D3DEE4", accent2: "#8E8AA0", success: "#6C8A78", warning: "#C0A063", danger: "#A76B6E", info: "#5F7A8A" } },
  { id: "clay", cn: "陶土", en: "Clay", mode: "浅", t: { bg: "#ECE3D8", surface: "#F4ECE1", surface2: "#E0D2C2", fg: "#4A3F35", muted: "#8C7B6B", border: "#DBCBB8", hover: "#E6D9C9", accent: "#A9744F", accentSoft: "#E8D6C4", accent2: "#9C8F6E", success: "#7E8A5E", warning: "#C79A54", danger: "#A85C4E", info: "#7C93A0" } },
  { id: "moss", cn: "苔庭", en: "Moss", mode: "浅", t: { bg: "#E6E7DC", surface: "#F0F1E7", surface2: "#D7D9C7", fg: "#40453A", muted: "#7C8168", border: "#CFD2BE", hover: "#DEE0CF", accent: "#6E7B54", accentSoft: "#DBE0C8", accent2: "#A88F6A", success: "#6E7B54", warning: "#C2A259", danger: "#A66B5E", info: "#74908C" } },
  { id: "ivory", cn: "素笺", en: "Ivory", mode: "浅", t: { bg: "#F4F0E8", surface: "#FBF8F2", surface2: "#E9E2D4", fg: "#2B2A26", muted: "#857E70", border: "#E0D8C8", hover: "#EFE9DD", accent: "#8C6E44", accentSoft: "#EBDFC9", accent2: "#6B7A6E", success: "#5F7A55", warning: "#B5893F", danger: "#97493F", info: "#5E7787" } },
  { id: "onyx", cn: "墨玉", en: "Onyx", mode: "深", t: { bg: "#1E2422", surface: "#262E2B", surface2: "#2F3835", fg: "#ECEAE3", muted: "#9AA39C", border: "#38423E", hover: "#2E3733", accent: "#86B7A6", accentSoft: "#2A3A35", accent2: "#C9A96A", success: "#7FB08A", warning: "#D2B36A", danger: "#D08A82", info: "#86A6B8" } },
  { id: "dusk", cn: "暮金", en: "Dusk", mode: "深", t: { bg: "#241E28", surface: "#2D2632", surface2: "#372E3D", fg: "#EDE7EC", muted: "#A79FAE", border: "#413748", hover: "#352C3B", accent: "#C6A981", accentSoft: "#3A3140", accent2: "#B08AA0", success: "#86A98C", warning: "#D3B36C", danger: "#D18A86", info: "#93A0C0" } },
  { id: "celadon", cn: "霁青", en: "Celadon", mode: "深", t: { bg: "#17262B", surface: "#1E3137", surface2: "#263D44", fg: "#E6ECEA", muted: "#93A6A6", border: "#31474D", hover: "#24383E", accent: "#8FBEB2", accentSoft: "#223A3C", accent2: "#C58A5E", success: "#82B492", warning: "#D2B06A", danger: "#D18C82", info: "#86AEC0" } },
];

/** 令牌 → CSS 变量名；danger 复用既有 --error，避免改动错误态样式。 */
const SCHEME_VARS: Record<keyof SchemeTokens, string> = {
  bg: "--bg", surface: "--surface", surface2: "--surface-2", fg: "--fg", muted: "--fg-muted",
  border: "--border", hover: "--hover", accent: "--accent", accentSoft: "--accent-soft", accent2: "--accent-2",
  success: "--success", warning: "--warning", danger: "--error", info: "--info",
};

let lang: "zh" | "en" = "zh";
const t = (key: keyof typeof I.zh): string => I[lang][key];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: ${id}`);
  return node as T;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

const app = el<HTMLElement>("app");
const sourceText = el<HTMLTextAreaElement>("sourceText");
const targetBody = el<HTMLDivElement>("targetBody");
const btnCopy = el<HTMLButtonElement>("btnCopy");
const btnTranslate = el<HTMLButtonElement>("btnTranslate");
const btnPin = el<HTMLButtonElement>("btnPin");
const btnDir = el<HTMLButtonElement>("btnDir");
const btnSettings = el<HTMLButtonElement>("btnSettings");
const btnMinimize = el<HTMLButtonElement>("btnMinimize");
const btnClose = el<HTMLButtonElement>("btnClose");
const btnBack = el<HTMLButtonElement>("btnBack");
const btnWatch = el<HTMLButtonElement>("btnWatch");
const watchToggle = el<HTMLButtonElement>("watchToggle");
const popupView = el<HTMLElement>("popupView");
const settingsView = el<HTMLElement>("settingsView");
const keyInput = el<HTMLInputElement>("keyInput");
const urlInput = el<HTMLInputElement>("urlInput");
const modelSel = el<HTMLSelectElement>("modelSel");
const limitInput = el<HTMLInputElement>("limitInput");
const btnEye = el<HTMLButtonElement>("btnEye");
const fsBtn = el<HTMLButtonElement>("fsBtn");
const fsPop = el<HTMLDivElement>("fsPop");
const fsVal = el<HTMLSpanElement>("fsVal");
const schemeGrid = el<HTMLDivElement>("schemeGrid");
const tip = el<HTMLDivElement>("tip");
const toastEl = el<HTMLDivElement>("toast");
const grip = el<HTMLDivElement>("grip");
const engineNote = el<HTMLSpanElement>("engineNote");
const charCount = el<HTMLSpanElement>("charCount");
const dictPathInput = el<HTMLInputElement>("dictPathInput");
const dictStatusEl = el<HTMLDivElement>("dictStatus");
const btnLibrary = el<HTMLButtonElement>("btnLibrary");
const libraryView = el<HTMLElement>("libraryView");
const btnLibBack = el<HTMLButtonElement>("btnLibBack");
const btnLibClear = el<HTMLButtonElement>("btnLibClear");
const tabHistory = el<HTMLButtonElement>("tabHistory");
const tabFav = el<HTMLButtonElement>("tabFav");
const libActions = el<HTMLDivElement>("libActions");
const btnExportCsv = el<HTMLButtonElement>("btnExportCsv");
const btnExportAnki = el<HTMLButtonElement>("btnExportAnki");
const libraryBody = el<HTMLDivElement>("libraryBody");
const cacheStats = el<HTMLSpanElement>("cacheStats");
const btnCacheClear = el<HTMLButtonElement>("btnCacheClear");
const hotkeyToggle = el<HTMLButtonElement>("hotkeyToggle");
const hotkeyHint = el<HTMLSpanElement>("hotkeyHint");
const autostartToggle = el<HTMLButtonElement>("autostartToggle");
const autostartState = el<HTMLSpanElement>("autostartState");

/** ECDICT tag 缩写 → 两种界面语言的标签 */
const TAG_LABELS: Record<string, { zh: string; en: string }> = {
  zk: { zh: "中考", en: "Zhongkao" }, gk: { zh: "高考", en: "Gaokao" },
  cet4: { zh: "四级", en: "CET-4" }, cet6: { zh: "六级", en: "CET-6" },
  ky: { zh: "考研", en: "Postgrad" }, toefl: { zh: "托福", en: "TOEFL" },
  ielts: { zh: "雅思", en: "IELTS" }, gre: { zh: "GRE", en: "GRE" },
};

let currentText = "";
let currentTranslation = "";
let paused = false;
let watching = true;
let pinned = false;
let settingsVisible = false;
let mergeTimer: number | undefined;
let idleTimer: number | undefined;
let requestSeq = 0;
let lastCopiedText = "";
let lastHandledText = "";
let lastHandledAt = 0;
let schemeId = "brume";
let cfg: AppConfig | null = null;
let translators = new Map<string, Translator>();
let activeId = "";
let direction: "en2zh" | "zh2en" = "en2zh";
/** 非空表示用户点过方向按钮，本次覆盖自动判向；下次复制新文本时清空。 */
let manualDirection: "en2zh" | "zh2en" | null = null;

let libraryVisible = false;
let libTab: "history" | "fav" = "history";
let favSet = new Set<string>();
let loadingTimer: number | undefined;
let loadingStart = 0;

interface HistoryRow {
  id: number; src: string; dst: string; dir: string; model: string; kind: string; created_at: number;
}
interface FavRow {
  word: string; entry: WordCard; created_at: number;
}

/**
 * 自动判向：分母只算「字母 + 汉字」，忽略空格、标点、数字。
 * 汉字占比 > 30% 判为中→英，否则英→中，避免中英混排时反复翻向。
 */
function detectDirection(text: string): "en2zh" | "zh2en" {
  let han = 0;
  let latin = 0;
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) han += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  const total = han + latin;
  if (total === 0) return "en2zh";
  return han / total > 0.3 ? "zh2en" : "en2zh";
}

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.className = "toast on";
  window.setTimeout(() => (toastEl.className = "toast"), 1400);
}

function maxChars(): number {
  return maxCharsOf(cfg);
}

function activeEngine() {
  return cfg?.engines.find((e) => e.id === activeId) ?? cfg?.engines[0];
}

function refreshLabels(): void {
  el<HTMLDivElement>("srcLabel").textContent = `${t("source")} · ${direction === "en2zh" ? "EN" : "ZH"}`;
  el<HTMLDivElement>("outLabel").textContent = `${t("target")} · ${direction === "en2zh" ? "中" : "EN"}`;
}

/** 底栏只显示当前引擎的具体模型名。配置尚未加载时留空，加载后由启动逻辑刷新。 */
function note(): string {
  const model = activeEngine()?.model;
  return model ? t("engineNote").replace("{model}", model) : "";
}

function setCopyVisible(visible: boolean): void {
  btnCopy.className = "icon copy-at-label" + (visible ? "" : " hidden");
}

function showTip(button: HTMLElement): void {
  tip.textContent = t(button.dataset.tip as keyof typeof I.zh);
  const win = app.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  tip.style.right = `${Math.max(8, Math.round(win.right - rect.right))}px`;
  tip.style.top = `${Math.round(rect.bottom - win.top + 6)}px`;
  tip.classList.add("on");
}

function hideTip(): void {
  tip.classList.remove("on");
  // 连文字一起清掉：即使窗口恢复时焦点意外回到按钮，也不会残留上一条提示
  tip.textContent = "";
}

// 委托到 document：动态创建的按钮（词典卡星标等）与工具条共用同一套即时气泡，
// 不走原生 title 的系统级悬浮延迟。mouseover/mouseout、focusin/focusout 会冒泡。
function tipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;
}
document.addEventListener("mouseover", (e) => { const b = tipTarget(e.target); if (b) showTip(b); });
document.addEventListener("mouseout", (e) => { const b = tipTarget(e.target); if (b && !b.contains(e.relatedTarget as Node)) hideTip(); });
document.addEventListener("focusin", (e) => { const b = tipTarget(e.target); if (b) showTip(b); });
document.addEventListener("focusout", (e) => { const b = tipTarget(e.target); if (b && !b.contains(e.relatedTarget as Node)) hideTip(); });

// 窗口最小化/失焦时鼠标不会移动、DOM 焦点也还在按钮上，
// mouseleave 与 blur 都不会触发，悬浮提示会一直挂到窗口恢复之后。
// 因此在窗口级别再兜一层，恢复时延时一拍清掉可能重新出现的提示。
window.addEventListener("blur", hideTip);
window.addEventListener("focus", () => window.setTimeout(hideTip, 0));
document.addEventListener("visibilitychange", () => { if (document.hidden) hideTip(); });

/* ---------- 主题 ---------- */

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function relLum(hex: string): number {
  const c = hexRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 强调色上的可读文字色：取浅字 / 深字中 WCAG 对比更高者。 */
function textOn(hex: string): string {
  const light = "#F6F4EF";
  const dark = "#1E1F1B";
  return contrast(hex, light) >= contrast(hex, dark) ? light : dark;
}

function schemeById(id: string): Scheme {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

function applyScheme(id: string): void {
  const scheme = schemeById(id);
  schemeId = scheme.id;
  for (const key of Object.keys(SCHEME_VARS) as Array<keyof SchemeTokens>) {
    app.style.setProperty(SCHEME_VARS[key], scheme.t[key]);
  }
  app.style.setProperty("--accent-fg", textOn(scheme.t.accent));
  document.querySelectorAll<HTMLButtonElement>(".scheme-tile").forEach((b) => {
    const on = b.dataset.id === scheme.id;
    b.className = "scheme-tile" + (on ? " on" : "");
    b.setAttribute("aria-pressed", String(on));
  });
  try {
    localStorage.setItem(THEME_KEY, scheme.id);
  } catch {
    /* 本地存储不可用时只影响记忆 */
  }
}

function readScheme(): string {
  try {
    const id = localStorage.getItem(THEME_KEY) ?? "";
    return SCHEMES.some((s) => s.id === id) ? id : "brume";
  } catch {
    return "brume";
  }
}

/* ---------- 字号 ---------- */

function applyFontSize(px: number): void {
  const out = clamp(Math.round(px || 20), 12, 52);
  app.style.setProperty("--fs-out", `${out}px`);
  app.style.setProperty("--fs-src", `${clamp(Math.round(out * 0.75), 11, 24)}px`);
  fsVal.textContent = `${out}px`;
  fsPop.querySelectorAll<HTMLButtonElement>(".fs-opt").forEach((b) => {
    b.className = "fs-opt" + (Number(b.dataset.px) === out ? " on" : "");
  });
  try {
    localStorage.setItem(FS_KEY, String(out));
  } catch {
    /* 同上 */
  }
}

function readFs(): number {
  try {
    const v = Number.parseInt(localStorage.getItem(FS_KEY) ?? "", 10);
    return Number.isNaN(v) ? 20 : v;
  } catch {
    return 20;
  }
}

function closeFsPop(): void {
  fsPop.hidden = true;
  fsBtn.setAttribute("aria-expanded", "false");
}

function openFsPop(): void {
  fsPop.hidden = false;
  fsBtn.setAttribute("aria-expanded", "true");
  const win = app.getBoundingClientRect();
  const rect = fsBtn.getBoundingClientRect();
  if (win.bottom - rect.bottom < 160) {
    fsPop.style.top = "auto";
    fsPop.style.bottom = "calc(100% + 4px)";
  } else {
    fsPop.style.top = "";
    fsPop.style.bottom = "";
  }
  const selected = fsPop.querySelector<HTMLElement>(".fs-opt.on");
  if (selected) {
    fsPop.scrollTop = Math.max(0, selected.offsetTop - fsPop.clientHeight / 2 + selected.offsetHeight / 2);
  }
}

for (let px = 12; px <= 52; px += 1) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "fs-opt";
  option.dataset.px = String(px);
  option.setAttribute("role", "option");
  option.textContent = `${px}px`;
  option.addEventListener("click", () => {
    applyFontSize(px);
    closeFsPop();
  });
  fsPop.appendChild(option);
}

SCHEMES.forEach((scheme) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "scheme-tile";
  b.dataset.id = scheme.id;
  b.dataset.mode = scheme.mode;
  b.setAttribute("aria-pressed", "false");
  b.title = `${scheme.cn} ${scheme.en} · ${scheme.mode}`;
  const head = document.createElement("span");
  head.className = "scheme-head";
  const cn = document.createElement("span");
  cn.className = "scheme-cn";
  cn.textContent = scheme.cn;
  const mode = document.createElement("span");
  mode.className = "scheme-mode";
  mode.textContent = scheme.mode;
  head.append(cn, mode);
  const en = document.createElement("span");
  en.className = "scheme-en";
  en.textContent = scheme.en;
  const strip = document.createElement("span");
  strip.className = "scheme-strip";
  for (const key of ["bg", "surface", "accent", "accent2"] as Array<keyof SchemeTokens>) {
    const cell = document.createElement("i");
    cell.style.background = scheme.t[key];
    strip.appendChild(cell);
  }
  b.append(head, en, strip);
  b.addEventListener("click", () => applyScheme(scheme.id));
  schemeGrid.appendChild(b);
});

/* ---------- 内容渲染 ---------- */

function stopLoading(): void {
  if (loadingTimer !== undefined) {
    window.clearInterval(loadingTimer);
    loadingTimer = undefined;
  }
}

function clearBody(): void {
  stopLoading();
  hideTip();
  targetBody.replaceChildren();
  targetBody.scrollTop = 0;
}

function renderFirstRun(): void {
  clearBody();
  const d = document.createElement("div");
  d.className = "first-run";
  d.textContent = t("firstRun");
  targetBody.appendChild(d);
  setCopyVisible(false);
  engineNote.textContent = note();
  charCount.textContent = "";
}

function renderLoading(wordMode = false): void {
  clearBody();
  const bars = document.createElement("div");
  bars.className = "state-bars";
  bars.innerHTML = "<i></i><i></i><i></i>";
  const model = wordMode ? WORD_FALLBACK_MODEL : (activeEngine()?.model ?? "");
  const msg = document.createElement("div");
  msg.className = "state-msg";
  msg.textContent = t("loadingHint") + (model ? ` · ${model}` : "");
  const elapsed = document.createElement("div");
  elapsed.className = "state-msg";
  targetBody.append(bars, msg, elapsed);
  if (wordMode) {
    const slow = document.createElement("div");
    slow.className = "state-msg";
    slow.textContent = t("loadingSlow");
    targetBody.appendChild(slow);
  }
  loadingStart = Date.now();
  elapsed.textContent = t("elapsedUnit").replace("{n}", "0");
  loadingTimer = window.setInterval(() => {
    const s = Math.floor((Date.now() - loadingStart) / 1000);
    elapsed.textContent = t("elapsedUnit").replace("{n}", String(s));
  }, 1000);
  setCopyVisible(false);
  engineNote.textContent = note();
}

function renderText(text: string): void {
  clearBody();
  const d = document.createElement("div");
  d.className = "target-text";
  d.textContent = text;
  targetBody.appendChild(d);
  currentTranslation = text;
  setCopyVisible(true);
  engineNote.textContent = note();
  charCount.textContent = "";
}

/**
 * 词典卡：原形提示 → 词头 + 音标 + 元信息 chips → 按词性分组的释义 → 例句（AI 详解时）。
 * 复用 styles.css 里现成的 .dict / .dict-base / .dict-ipa / .sense-row 体系。
 */
function renderWordCard(card: WordCard, queryWord: string): void {
  clearBody();
  const wrap = document.createElement("div");
  wrap.className = "dict";

  if (card.lemma && card.lemma.toLowerCase() !== queryWord.toLowerCase()) {
    const base = document.createElement("div");
    base.className = "dict-base";
    const label = document.createElement("span");
    label.className = "base-label";
    label.textContent = `${queryWord} · ${t("baseLabel")}`;
    const word = document.createElement("span");
    word.className = "base-word";
    word.textContent = card.lemma;
    base.append(label, word);
    wrap.appendChild(base);
  }

  const head = document.createElement("div");
  head.className = "dict-head";
  const title = document.createElement("span");
  title.className = "dict-title";
  title.textContent = card.word;
  head.appendChild(title);
  if (card.phonetic) {
    const ipa = document.createElement("span");
    ipa.className = "dict-phonetic";
    ipa.textContent = card.phonetic.startsWith("/") ? card.phonetic : `/${card.phonetic}/`;
    head.appendChild(ipa);
  }
  const isFav = favSet.has(queryWord.toLowerCase());
  const fav = document.createElement("button");
  fav.type = "button";
  fav.className = "dict-fav" + (isFav ? " on" : "");
  fav.dataset.tip = isFav ? "favRemove" : "favAdd";
  fav.setAttribute("aria-label", t(isFav ? "favRemove" : "favAdd"));
  fav.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8.2l4.7-.7z"/></svg>';
  fav.addEventListener("click", () => void toggleFavorite(card, queryWord, fav));
  head.appendChild(fav);
  wrap.appendChild(head);

  const chips: string[] = [];
  if (card.collins) chips.push(t("collinsStar").replace("{n}", String(card.collins)));
  if (card.oxford) chips.push(t("oxfordWord"));
  for (const tag of card.tags ?? []) {
    const label = TAG_LABELS[tag.toLowerCase()];
    chips.push(label ? label[lang] : tag);
  }
  if (chips.length > 0) {
    const meta = document.createElement("div");
    meta.className = "dict-meta";
    for (const text of chips) {
      const chip = document.createElement("span");
      chip.className = "dict-chip";
      chip.textContent = text;
      meta.appendChild(chip);
    }
    wrap.appendChild(meta);
  }

  const rows = document.createElement("div");
  rows.className = "sense-rows";
  for (const sense of card.senses) {
    const row = document.createElement("div");
    row.className = "sense-row";
    const pos = document.createElement("span");
    pos.className = "d-pos";
    pos.textContent = sense.pos;
    const gloss = document.createElement("span");
    gloss.className = "gloss-list";
    gloss.textContent = sense.def;
    row.append(pos, gloss);
    rows.appendChild(row);
  }
  wrap.appendChild(rows);

  if (card.example) {
    const ex = document.createElement("div");
    ex.className = "dict-example";
    const label = document.createElement("div");
    label.className = "dict-example-label";
    label.textContent = t("exampleLabel");
    const en = document.createElement("div");
    en.className = "dict-example-en";
    en.textContent = card.example;
    ex.append(label, en);
    if (card.exampleCn) {
      const cn = document.createElement("div");
      cn.className = "dict-example-cn";
      cn.textContent = card.exampleCn;
      ex.appendChild(cn);
    }
    wrap.appendChild(ex);
  }

  targetBody.appendChild(wrap);
  currentTranslation = card.senses
    .map((s) => (s.pos ? `${s.pos} ${s.def}` : s.def))
    .join("\n");
  setCopyVisible(true);
  engineNote.textContent = card.source === "dict" || card.source === "lemma"
    ? t("noteDict")
    : t("noteWordAi").replace("{model}", WORD_FALLBACK_MODEL);
  charCount.textContent = "";
}

function renderError(message: string): void {
  clearBody();
  const box = document.createElement("div");
  const h = document.createElement("div");
  h.className = "state-error";
  h.textContent = `${activeEngine()?.displayName ?? t("brand")} · ${message}`;
  const sub = document.createElement("div");
  sub.className = "state-error sub";
  sub.textContent = t("errorSub");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry";
  retry.textContent = t("retry");
  retry.addEventListener("click", () => {
    cfg = null;
    translators = new Map();
    if (currentText) void runTranslation(currentText, true);
  });
  box.append(h, sub, retry);
  targetBody.appendChild(box);
  setCopyVisible(false);
  engineNote.textContent = note();
}

function renderSkip(text: string, forced: () => void): void {
  clearBody();
  const box = document.createElement("div");
  const h = document.createElement("div");
  h.className = "skip-title";
  h.textContent = t("skipTitle");
  const sub = document.createElement("div");
  sub.className = "skip-sub";
  sub.textContent = t("skipSub")
    .replace("{n}", String(Array.from(text).length))
    .replace("{m}", String(maxChars()));
  const force = document.createElement("button");
  force.type = "button";
  force.className = "force";
  force.textContent = t("force");
  force.addEventListener("click", forced);
  box.append(h, sub, force);
  targetBody.appendChild(box);
  setCopyVisible(false);
  engineNote.textContent = note();
  charCount.textContent = "";
}

/* ---------- 历史 / 生词本 / 缓存 / 热键 / 自启 ---------- */

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(secs: number): string {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sensesText(card: WordCard): string {
  return (card.senses ?? []).map((s) => (s.pos ? `${s.pos} ${s.def}` : s.def)).join("；");
}

async function refreshFavSet(): Promise<void> {
  try {
    const items = await invoke<FavRow[]>("favorite_list");
    favSet = new Set(items.map((it) => it.word.toLowerCase()));
  } catch {
    favSet = new Set();
  }
}

async function toggleFavorite(card: WordCard, queryWord: string, btn: HTMLButtonElement): Promise<void> {
  const key = queryWord.toLowerCase();
  const wasFav = favSet.has(key);
  try {
    if (wasFav) {
      await invoke("favorite_remove", { word: key });
      favSet.delete(key);
    } else {
      await invoke("favorite_put", { word: key, entry: card });
      favSet.add(key);
    }
    const nowFav = favSet.has(key);
    btn.className = "dict-fav" + (nowFav ? " on" : "");
    btn.dataset.tip = nowFav ? "favRemove" : "favAdd";
    btn.setAttribute("aria-label", t(nowFav ? "favRemove" : "favAdd"));
    toast(t(nowFav ? "favAdded" : "favRemoved"));
    if (libraryVisible && libTab === "fav") void renderLibrary();
  } catch (err) {
    toast(`${t("opFail")}：${String(err)}`);
  }
}

async function removeFav(word: string): Promise<void> {
  try {
    await invoke("favorite_remove", { word });
    favSet.delete(word.toLowerCase());
    toast(t("favRemoved"));
    void renderLibrary();
  } catch (err) {
    toast(`${t("opFail")}：${String(err)}`);
  }
}

function recordWordHistory(word: string, card: WordCard): void {
  const model = card.source === "dict" || card.source === "lemma" ? "ecdict" : WORD_FALLBACK_MODEL;
  void invoke("history_add", { src: word, dst: sensesText(card), dir: "en2zh", model, kind: "word" })
    .catch(() => undefined);
}

function recordTextHistory(src: string, dst: string): void {
  void invoke("history_add", { src, dst, dir: direction, model: activeEngine()?.model ?? "", kind: "text" })
    .catch(() => undefined);
}

function openLibrary(): void {
  libraryVisible = true;
  settingsVisible = false;
  popupView.classList.add("hidden");
  settingsView.classList.add("hidden");
  libraryView.classList.remove("hidden");
  closeFsPop();
  void refreshFavSet();
  void renderLibrary();
}

function closeLibrary(): void {
  libraryVisible = false;
  libraryView.classList.add("hidden");
  popupView.classList.remove("hidden");
}

function setLibTab(tab: "history" | "fav"): void {
  libTab = tab;
  tabHistory.className = tab === "history" ? "on" : "";
  tabFav.className = tab === "fav" ? "on" : "";
  libActions.classList.toggle("hidden", tab !== "fav");
  void renderLibrary();
}

function libEmpty(message: string): void {
  const d = document.createElement("div");
  d.className = "lib-empty";
  d.textContent = message;
  libraryBody.appendChild(d);
}

function copyText(text: string): void {
  lastCopiedText = text;
  void invoke("set_clipboard_text", { text })
    .then(() => toast(t("copied")))
    .catch((err: unknown) => toast(`${t("copyFail")}：${String(err)}`));
}

function historyRow(r: HistoryRow): HTMLElement {
  const row = document.createElement("div");
  row.className = "lib-row";
  const main = document.createElement("div");
  main.className = "lib-main";
  const src = document.createElement("div");
  src.className = "lib-src";
  src.textContent = r.src;
  const dst = document.createElement("div");
  dst.className = "lib-dst";
  dst.textContent = r.dst;
  const meta = document.createElement("div");
  meta.className = "lib-meta";
  meta.textContent = `${t(r.kind === "word" ? "histWord" : "histText")} · ${r.model} · ${fmtTime(r.created_at)}`;
  main.append(src, dst, meta);
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "icon lib-copy";
  copy.title = t("copy");
  copy.setAttribute("aria-label", t("copy"));
  copy.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 4H5.5A1.5 1.5 0 0 0 4 5.5V13"/></svg>';
  copy.addEventListener("click", (e) => { e.stopPropagation(); copyText(r.dst); });
  row.append(main, copy);
  row.addEventListener("click", () => replayHistory(r));
  return row;
}

function favRow(it: FavRow): HTMLElement {
  const row = document.createElement("div");
  row.className = "lib-row";
  const main = document.createElement("div");
  main.className = "lib-main";
  const w = document.createElement("div");
  w.className = "lib-src";
  w.textContent = it.entry.phonetic ? `${it.word}  /${it.entry.phonetic}/` : it.word;
  const d = document.createElement("div");
  d.className = "lib-dst";
  d.textContent = sensesText(it.entry);
  main.append(w, d);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon lib-copy";
  del.title = t("favRemove");
  del.setAttribute("aria-label", t("favRemove"));
  del.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/></svg>';
  del.addEventListener("click", (e) => { e.stopPropagation(); void removeFav(it.word); });
  row.append(main, del);
  row.addEventListener("click", () => {
    closeLibrary();
    currentText = it.word;
    direction = "en2zh";
    manualDirection = "en2zh";
    refreshLabels();
    sourceText.value = it.word;
    renderWordCard(it.entry, it.word);
  });
  return row;
}

function replayHistory(r: HistoryRow): void {
  closeLibrary();
  currentText = r.src;
  direction = r.dir === "zh2en" ? "zh2en" : "en2zh";
  manualDirection = direction;
  refreshLabels();
  sourceText.value = r.src;
  renderText(r.dst);
}

async function renderLibrary(): Promise<void> {
  libraryBody.replaceChildren();
  if (libTab === "history") {
    const rows = await invoke<HistoryRow[]>("history_list").catch(() => [] as HistoryRow[]);
    if (rows.length === 0) { libEmpty(t("libEmptyHistory")); return; }
    for (const r of rows) libraryBody.appendChild(historyRow(r));
  } else {
    const items = await invoke<FavRow[]>("favorite_list").catch(() => [] as FavRow[]);
    if (items.length === 0) { libEmpty(t("libEmptyFav")); return; }
    for (const it of items) libraryBody.appendChild(favRow(it));
  }
}

async function clearLibrary(): Promise<void> {
  try {
    if (libTab === "history") {
      await invoke("history_clear");
    } else {
      const items = await invoke<FavRow[]>("favorite_list").catch(() => [] as FavRow[]);
      for (const it of items) await invoke("favorite_remove", { word: it.word }).catch(() => undefined);
      favSet.clear();
    }
    toast(t("libCleared"));
    void renderLibrary();
  } catch (err) {
    toast(`${t("opFail")}：${String(err)}`);
  }
}

async function exportFav(format: "csv" | "anki"): Promise<void> {
  try {
    const path = await invoke<string>("favorites_export", { format });
    toast(`${t("exported")}：${path}`);
  } catch (err) {
    toast(`${t("opFail")}：${String(err)}`);
  }
}

async function refreshCacheStats(): Promise<void> {
  try {
    const s = await invoke<{ count: number; bytes: number }>("cache_stats");
    cacheStats.textContent = t("cacheStatsFmt").replace("{n}", String(s.count)).replace("{size}", fmtBytes(s.bytes));
  } catch {
    cacheStats.textContent = "—";
  }
}

function paintHotkeyHint(): void {
  if (hotkeyToggle.disabled) {
    hotkeyHint.classList.remove("keys");
    hotkeyHint.textContent = t("hotkeyUnavailable");
    return;
  }
  if (hotkeyToggle.getAttribute("aria-checked") === "true") {
    hotkeyHint.classList.add("keys");
    hotkeyHint.innerHTML = "<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>";
  } else {
    hotkeyHint.classList.remove("keys");
    hotkeyHint.textContent = t("off");
  }
}

function setHotkeyUI(on: boolean): void {
  hotkeyToggle.className = "sw" + (on ? " on" : "");
  hotkeyToggle.setAttribute("aria-checked", String(on));
  paintHotkeyHint();
}

async function initHotkey(): Promise<void> {
  let available = false;
  try { available = await invoke<boolean>("hotkey_available"); } catch { /* 视为不可用 */ }
  if (!available) {
    hotkeyToggle.className = "sw";
    hotkeyToggle.setAttribute("aria-checked", "false");
    hotkeyToggle.disabled = true;
    paintHotkeyHint();
    return;
  }
  hotkeyToggle.disabled = false;
  let enabled = true;
  try { enabled = localStorage.getItem("wb_hotkey") !== "0"; } catch { /* 默认开 */ }
  setHotkeyUI(enabled);
  void invoke("hotkey_set", { enabled }).catch(() => undefined);
}

function setAutostartUI(on: boolean): void {
  autostartToggle.className = "sw" + (on ? " on" : "");
  autostartToggle.setAttribute("aria-checked", String(on));
  autostartState.textContent = t(on ? "on" : "off");
}

async function initAutostart(): Promise<void> {
  let on = false;
  try { on = await invoke<boolean>("autostart_get"); } catch { /* 默认关 */ }
  setAutostartUI(on);
}

/* ---------- 配置与翻译 ---------- */

async function ensureConfig(): Promise<AppConfig> {
  if (cfg && translators.size > 0) return cfg;
  const loaded = await loadConfig();
  // 凭证无效也要先记住配置：设置表单读 cfg，
  // 否则表单停留 HTML 默认值，任何一次保存都会把磁盘配置覆盖成默认值
  cfg = loaded;
  const problem = loaded.engines.map(validateEngine).find((x) => x !== null);
  if (problem) throw new Error(problem);
  const map = buildTranslators(loaded);
  if (map.size === 0) throw new Error("配置里没有可用的 hy 引擎");
  translators = map;
  activeId = loaded.defaultEngineId && map.has(loaded.defaultEngineId)
    ? loaded.defaultEngineId
    : loaded.engines[0].id;
  return loaded;
}

/**
 * 单词详解分流：本地词典 → AI 缓存 → AI JSON 兜底（失败重试 1 次）。
 * 返回 true 表示已渲染结果；false 表示任一环节不可用，调用方降级回句子翻译。
 * 词典文件缺失、AI 兜底失败都不弹错误——句子翻译永远能给出一个结果。
 */
async function tryWordFlow(text: string, seq: number): Promise<boolean> {
  let loaded: AppConfig;
  try {
    // 只读配置不校验凭证：词典命中不需要 API Key，未填 Key 时也应出词典卡
    loaded = await loadConfig();
  } catch {
    return false; // 配置不可用，交给句子流程统一报错
  }
  try {
    const res = await invoke<DictLookupReply>("dict_lookup", { word: text });
    if (seq !== requestSeq) return true;
    if (res.found && res.entry) {
      const card: WordCard = res.source === "cache"
        ? { ...(res.entry as WordCard), source: "cache" }
        : cardFromDictEntry(res.entry as RawDictEntry, res.source ?? "dict", res.lemma ?? undefined);
      if (card.senses.length > 0) {
        renderWordCard(card, text);
        recordWordHistory(text, card);
        return true;
      }
    }
  } catch {
    /* 词典缺失或损坏：继续走 AI 详解 */
  }

  try {
    await ensureConfig();
  } catch {
    return seq !== requestSeq; // 凭证不可用（如未填 Key）：词典已试过，降级句子流程报错
  }
  const engine = activeEngine();
  if (!engine) return false;
  try {
    const card = await aiWordLookup(engine, text, timeoutOf(loaded));
    if (seq !== requestSeq) return true;
    renderWordCard(card, text);
    recordWordHistory(text, card);
    void invoke("dict_cache_put", { word: text, entry: card, model: WORD_FALLBACK_MODEL })
      .catch(() => undefined);
    return true;
  } catch {
    return seq !== requestSeq; // 兜底失败且未被新请求顶替 → 降级句子翻译
  }
}

async function runTranslation(text: string, force = false): Promise<void> {
  const seq = ++requestSeq;
  currentText = text;
  if (!manualDirection) {
    direction = detectDirection(text);
    refreshLabels();
  }
  // 原文框由调用方填充（剪贴板 / 手动输入 / 历史回看），这里不再改写，避免覆盖用户正在编辑的草稿
  charCount.textContent = "";

  if (!force && Array.from(text).length > maxChars()) {
    renderSkip(text, () => void runTranslation(text, true));
    return;
  }

  const wordMode = direction === "en2zh" && isSingleEnglishWord(text);
  renderLoading(wordMode);
  // 单个英文单词且方向为英→中：先走词典详解，任何环节不可用都无感降级为句子翻译
  if (wordMode) {
    if (await tryWordFlow(text, seq)) return;
    if (seq !== requestSeq) return;
  }
  try {
    await ensureConfig();
    const translator = translators.get(activeId);
    if (!translator) throw new Error("当前引擎不可用");
    const result = await translator.translate({
      text,
      from: direction === "en2zh" ? "en" : "zh",
      to: direction === "en2zh" ? "zh" : "en",
    });
    if (seq !== requestSeq) return;
    renderText(result.text);
    recordTextHistory(text, result.text);
  } catch (err) {
    if (seq !== requestSeq) return;
    renderError(err instanceof Error ? err.message : String(err));
  }
}

function handleClipboard(text: string): void {
  if (paused || !watching) return;
  const now = Date.now();
  if (text === lastHandledText && now - lastHandledAt < DUP_WINDOW_MS) return;
  if (mergeTimer !== undefined) window.clearTimeout(mergeTimer);
  mergeTimer = window.setTimeout(() => {
    lastHandledText = text;
    lastHandledAt = Date.now();
    manualDirection = null;
    sourceText.value = text;
    void runTranslation(text);
  }, MERGE_MS);
}

/* ---------- 设置页 ---------- */

const KEY_MASK = "************";
let keyShown = false;

/** 已落盘且有效的 API Key；配置模板里的占位符视为未填。 */
function savedKey(): string {
  const key = activeEngine()?.apiKey?.trim() ?? "";
  if (!key || key.includes("在这里填") || /^your/i.test(key) || key === KEY_MASK) return "";
  return key;
}

function keyPlaceholder(): string {
  return savedKey() ? KEY_MASK : t("keyEmpty");
}

/** 隐藏态：输入框不留明文，只用若干星号表示「已保存」。 */
function hideKey(): void {
  keyShown = false;
  keyInput.value = "";
  keyInput.type = "password";
  keyInput.placeholder = keyPlaceholder();
}

/** 词典状态行：路径、是否加载、词条量、变形反查表是否已构建。 */
async function refreshDictStatus(): Promise<void> {
  try {
    const status = await invoke<{ path?: string; exists?: boolean; entries?: number; inflections?: boolean; error?: string }>("dict_status");
    if (status.exists) {
      const n = (status.entries ?? 0).toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
      dictStatusEl.textContent = t("dictStatusOk").replace("{n}", n)
        + (status.inflections ? t("dictStatusLemma") : t("dictStatusNoLemma"));
    } else {
      dictStatusEl.textContent = `${t("dictStatusMissing")}（${status.path ?? ""}）`;
    }
  } catch (err) {
    dictStatusEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

function fillSettings(): void {
  const engine = cfg?.engines[0];
  urlInput.value = engine?.baseUrl || DEFAULT_BASE_URL;
  modelSel.value = MODEL_CHOICES.includes((engine?.model ?? "") as typeof MODEL_CHOICES[number])
    ? (engine?.model ?? DEFAULT_MODEL)
    : DEFAULT_MODEL;
  limitInput.value = String(maxChars());
  dictPathInput.value = cfg?.dictPath ?? "";
  hideKey();
  void refreshDictStatus();
  void refreshCacheStats();
  void initAutostart();
}

MODEL_CHOICES.forEach((m) => {
  const o = document.createElement("option");
  o.value = m;
  o.textContent = m;
  modelSel.appendChild(o);
});

function openSettings(): void {
  settingsVisible = true;
  libraryVisible = false;
  popupView.classList.add("hidden");
  libraryView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  closeFsPop();
  fillSettings();
}

function closeSettings(): void {
  settingsVisible = false;
  settingsView.classList.add("hidden");
  popupView.classList.remove("hidden");
  closeFsPop();
  hideKey();
}

let saveTimer = 0;
let persistChain: Promise<void> = Promise.resolve();

/** 读取当前表单并写回 config.local.json；不重填表单，避免打断正在输入的内容。 */
async function persistNow(clearKey: boolean): Promise<void> {
  const patch: SettingsPatch = {
    baseUrl: urlInput.value.trim() || DEFAULT_BASE_URL,
    model: modelSel.value || DEFAULT_MODEL,
    maxChars: clamp(Math.round(Number(limitInput.value) || 2000), 200, 2000),
    timeoutMs: timeoutOf(cfg),
    dictPath: dictPathInput.value.trim(),
  };
  const key = keyInput.value.trim();
  if (key) patch.apiKey = key;
  try {
    await saveSettings(patch);
    cfg = null;
    translators = new Map();
    await ensureConfig().catch(() => undefined);
    if (clearKey) hideKey();
  } catch (err) {
    toast(`${t("saveFail")}：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 串行写文件，避免多个控件同时改动时并发覆盖同一份配置。 */
function persist(clearKey = false): void {
  persistChain = persistChain.then(() => persistNow(clearKey)).catch(() => undefined);
}

/** 文本框防抖：停顿 500ms 即保存，不打断连续输入。 */
function schedulePersist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persist(), 500);
}

/* ---------- 开关与按钮 ---------- */

/** 空闲计时：30 分钟没收到任何剪贴板文本就自动暂停，之后需手动重新打开。 */
function armIdleTimer(): void {
  if (idleTimer !== undefined) window.clearTimeout(idleTimer);
  idleTimer = undefined;
  if (!watching) return;
  idleTimer = window.setTimeout(() => {
    idleTimer = undefined;
    setWatch(false);
    toast(t("watchIdle"));
  }, WATCH_IDLE_MS);
}

function setWatch(on: boolean): void {
  watching = on;
  paused = !on;
  const tipKey = on ? "watchOn" : "watchOff";
  const stateKey = on ? "watchStateOn" : "watchStateOff";
  btnWatch.className = "sw" + (on ? " on" : "");
  btnWatch.dataset.tip = tipKey;
  btnWatch.setAttribute("aria-checked", String(on));
  btnWatch.setAttribute("aria-label", t(stateKey));
  watchToggle.className = "sw" + (on ? " on" : "");
  watchToggle.setAttribute("aria-checked", String(on));
  watchToggle.setAttribute("aria-label", t("watchLabel"));
  el<HTMLSpanElement>("watchState").textContent = t(stateKey);
  engineNote.textContent = note();
  try { localStorage.setItem("wb_watch", on ? "1" : "0"); } catch { /* 本地存储不可用时忽略 */ }
  void invoke("set_paused", { paused: !on }).catch(() => undefined);
  armIdleTimer();
}

function togglePin(next?: boolean): void {
  pinned = next ?? !pinned;
  btnPin.className = "icon" + (pinned ? " pinned" : "");
  btnPin.setAttribute("aria-pressed", String(pinned));
  el<HTMLButtonElement>("pinOn").className = pinned ? "on" : "";
  el<HTMLButtonElement>("pinOff").className = pinned ? "" : "on";
  try { localStorage.setItem("wb_pin", pinned ? "1" : "0"); } catch { /* 同上 */ }
  void invoke("set_always_on_top", { pinned }).catch(() => undefined);
  toast(pinned ? t("pinned") : t("unpinned"));
}

function applyLang(next: "zh" | "en"): void {
  lang = next;
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  const texts: Array<[string, keyof typeof I.zh]> = [
    ["settingsTitle", "settingsTitle"], ["grpConn", "grpConn"], ["grpBehav", "grpBehav"],
    ["grpLook", "grpLook"], ["keyLabel", "keyLabel"], ["urlLabel", "urlLabel"],
    ["modelLabel", "modelLabel"],
    ["keyHint", "keyHint"], ["watchLabel", "watchLabel"],
    ["limitLabel", "limitLabel"], ["limitUnit", "limitUnit"], ["limitHint", "limitHint"],
    ["dictHint", "dictHint"], ["dictPathLabel", "dictPathLabel"], ["langLabel", "langLabel"],
    ["cacheLabel", "cacheLabel"], ["btnCacheClear", "cacheClear"], ["hotkeyLabel", "hotkeyLabel"],
    ["hotkeyDesc", "hotkeyDesc"],
    ["autostartLabel", "autostartLabel"], ["libTitle", "library"], ["tabHistory", "tabHistory"],
    ["tabFav", "tabFav"], ["btnExportCsv", "exportCsv"], ["btnExportAnki", "exportAnki"],
    ["fsLabel", "fsLabel"], ["themeLabel", "themeLabel"], ["brandTop", "brand"],
    ["pinLabel", "pinLabel"],
  ];
  texts.forEach(([id, key]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = t(key);
  });
  el<HTMLButtonElement>("pinOff").textContent = t("off");
  el<HTMLButtonElement>("pinOn").textContent = t("on");
  el<HTMLSpanElement>("watchState").textContent = t(watching ? "watchStateOn" : "watchStateOff");
  document.querySelectorAll<HTMLElement>("[data-tip]").forEach((b) => {
    b.setAttribute("aria-label", t(b.dataset.tip as keyof typeof I.zh));
  });
  fsBtn.setAttribute("aria-label", t("fsLabel"));
  keyInput.setAttribute("aria-label", t("keyLabel"));
  urlInput.setAttribute("aria-label", t("urlLabel"));
  modelSel.setAttribute("aria-label", t("modelLabel"));
  limitInput.setAttribute("aria-label", t("limitLabel"));
  sourceText.placeholder = t("srcPlaceholder");
  sourceText.setAttribute("aria-label", t("source"));
  document.title = t("brand");
  document.querySelectorAll<HTMLButtonElement>(".scheme-tile").forEach((b) => {
    const modeZh = b.dataset.mode ?? "";
    const modeText = lang === "zh" ? modeZh : (modeZh === "深" ? "Dark" : "Light");
    const mode = b.querySelector<HTMLElement>(".scheme-mode");
    if (mode) mode.textContent = modeText;
    const cn = b.querySelector<HTMLElement>(".scheme-cn")?.textContent ?? "";
    const en = b.querySelector<HTMLElement>(".scheme-en")?.textContent ?? "";
    b.title = `${cn} ${en} · ${modeText}`;
  });
  document.querySelectorAll<HTMLButtonElement>("#langSeg button").forEach((b) => {
    b.className = b.dataset.lang === lang ? "on" : "";
  });
  hideTip();
  refreshLabels();
  void refreshDictStatus();
  void refreshCacheStats();
  setAutostartUI(autostartToggle.getAttribute("aria-checked") === "true");
  paintHotkeyHint();
  if (libraryVisible) void renderLibrary();
  applyScheme(schemeId);
  if (settingsVisible) {
    // 只刷新本地化文案，不清空用户尚未保存的输入
    if (!keyInput.value) keyInput.placeholder = keyPlaceholder();
  }
}

btnWatch.addEventListener("click", () => {
  setWatch(!watching);
  toast(t(watching ? "watchToastOn" : "watchToastOff"));
});
watchToggle.addEventListener("click", () => setWatch(!watching));
btnPin.addEventListener("click", () => togglePin());
el<HTMLButtonElement>("pinOff").addEventListener("click", () => { if (pinned) togglePin(false); });
el<HTMLButtonElement>("pinOn").addEventListener("click", () => { if (!pinned) togglePin(true); });
btnDir.addEventListener("click", () => {
  direction = direction === "en2zh" ? "zh2en" : "en2zh";
  manualDirection = direction;
  refreshLabels();
  toast(t("dirToast"));
  if (currentText) void runTranslation(currentText);
});
btnSettings.addEventListener("click", () => (settingsVisible ? closeSettings() : openSettings()));
btnBack.addEventListener("click", closeSettings);
btnLibrary.addEventListener("click", () => (libraryVisible ? closeLibrary() : openLibrary()));
btnLibBack.addEventListener("click", closeLibrary);
btnLibClear.addEventListener("click", () => void clearLibrary());
tabHistory.addEventListener("click", () => setLibTab("history"));
tabFav.addEventListener("click", () => setLibTab("fav"));
btnExportCsv.addEventListener("click", () => void exportFav("csv"));
btnExportAnki.addEventListener("click", () => void exportFav("anki"));
btnCacheClear.addEventListener("click", () => {
  void invoke("cache_clear")
    .then(() => { toast(t("cacheCleared")); void refreshCacheStats(); })
    .catch((err: unknown) => toast(`${t("opFail")}：${String(err)}`));
});
hotkeyToggle.addEventListener("click", () => {
  if (hotkeyToggle.disabled) return;
  const on = hotkeyToggle.getAttribute("aria-checked") !== "true";
  setHotkeyUI(on);
  try { localStorage.setItem("wb_hotkey", on ? "1" : "0"); } catch { /* 本地存储不可用时忽略 */ }
  void invoke("hotkey_set", { enabled: on }).catch(() => undefined);
});
autostartToggle.addEventListener("click", () => {
  const on = autostartToggle.getAttribute("aria-checked") !== "true";
  void invoke("autostart_set", { enabled: on })
    .then(() => { setAutostartUI(on); toast(t(on ? "autostartOn" : "autostartOff")); })
    .catch((err: unknown) => toast(`${t("opFail")}：${String(err)}`));
});
btnMinimize.addEventListener("click", () => {
  hideTip();
  btnMinimize.blur();
  void invoke("minimize_window").catch(() => undefined);
});
btnClose.addEventListener("click", () => void invoke("hide_window").catch(() => undefined));
// 设置项改完即存，不再需要保存按钮
keyInput.addEventListener("input", schedulePersist);
keyInput.addEventListener("blur", (event) => {
  // 点「显示密钥」引起的失焦不能把刚显示的明文清掉
  if ((event.relatedTarget as HTMLElement | null)?.id === "btnEye") return;
  persist(true);
});
urlInput.addEventListener("input", schedulePersist);
modelSel.addEventListener("change", () => persist());
dictPathInput.addEventListener("input", schedulePersist);
dictPathInput.addEventListener("change", () => { persist(); void refreshDictStatus(); });
btnEye.addEventListener("click", () => {
  if (keyShown) { hideKey(); toast(t("keyHidden")); return; }
  const key = savedKey();
  if (!key) { toast(t("keyMissing")); return; }
  keyShown = true;
  keyInput.value = key;
  keyInput.type = "text";
  keyInput.placeholder = "";
  toast(t("keyShown"));
});

btnCopy.addEventListener("click", () => {
  if (!currentTranslation) return;
  lastCopiedText = currentTranslation;
  void invoke("set_clipboard_text", { text: currentTranslation })
    .then(() => toast(t("copied")))
    .catch((err: unknown) => toast(`${t("copyFail")}：${String(err)}`));
});

// 手动输入：复用同一条翻译管线。Enter 翻译、Shift+Enter 换行；输入法组词期间的 Enter 不触发。
function triggerManual(): void {
  const text = sourceText.value.trim();
  if (!text) return;
  void runTranslation(text);
}
btnTranslate.addEventListener("click", triggerManual);
sourceText.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  triggerManual();
});

document.querySelectorAll<HTMLButtonElement>("#langSeg button").forEach((b) => {
  b.addEventListener("click", () => applyLang(b.dataset.lang === "en" ? "en" : "zh"));
});
fsBtn.addEventListener("click", () => (fsPop.hidden ? openFsPop() : closeFsPop()));
document.addEventListener("click", (event) => {
  const target = event.target as Element;
  if (!target.closest(".fs-ctl")) closeFsPop();
});
limitInput.addEventListener("change", () => {
  limitInput.value = String(clamp(Math.round(Number(limitInput.value) || 2000), 200, 2000));
  persist();
});

let dragging = false;
let startX = 0;
let startY = 0;
let startW = 0;
let startH = 0;
let pendingSize: { w: number; h: number } | null = null;
let rafId = 0;
function scheduleResize(w: number, h: number): void {
  pendingSize = { w, h };
  if (rafId) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = 0;
    if (pendingSize) {
      void invoke("resize_view", { width: pendingSize.w, height: pendingSize.h }).catch(() => undefined);
    }
  });
}
grip.addEventListener("pointerdown", (event) => {
  dragging = true;
  startX = event.clientX;
  startY = event.clientY;
  startW = app.offsetWidth;
  startH = app.offsetHeight;
  try { grip.setPointerCapture(event.pointerId); } catch { /* 降级为普通拖拽 */ }
  event.preventDefault();
});
grip.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  scheduleResize(
    clamp(startW + event.clientX - startX, 320, 760),
    clamp(startH + event.clientY - startY, 240, 620),
  );
});
grip.addEventListener("pointerup", (event) => {
  dragging = false;
  try { grip.releasePointerCapture(event.pointerId); } catch { /* 同上 */ }
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!fsPop.hidden) { closeFsPop(); return; }
  if (libraryVisible) { closeLibrary(); return; }
  if (settingsVisible) { closeSettings(); return; }
  void invoke("hide_window").catch(() => undefined);
});

void invoke("start_clipboard_watch").catch(() => undefined);
void listen<{ text: string }>("clipboard-changed", (event) => {
  // 剪贴板文本的唯一入口：这里统一去掉首尾空白，后面的显示、去重、
  // 长度判断与 POST 模板拼接全部使用同一个干净值。全空白内容直接忽略。
  const text = event.payload.text?.trim() ?? "";
  if (!text) return;
  // 收到任何文本都算活动（含超上限被跳过、重复文本），重置空闲计时
  armIdleTimer();
  if (text === lastCopiedText) return;
  handleClipboard(text);
}).catch(() => undefined);
void listen<boolean>("pause-changed", (event) => setWatch(!event.payload)).catch(() => undefined);
void listen("open-settings", () => openSettings()).catch(() => undefined);

void ensureConfig()
  .then(() => { fillSettings(); refreshLabels(); engineNote.textContent = note(); })
  .catch(() => { fillSettings(); refreshLabels(); });
applyFontSize(readFs());
applyScheme(readScheme());
applyLang("zh");
renderFirstRun();
try {
  if (localStorage.getItem("wb_watch") === "0") setWatch(false);
  if (localStorage.getItem("wb_pin") === "1") {
    pinned = true;
    btnPin.className = "icon pinned";
    btnPin.setAttribute("aria-pressed", "true");
    el<HTMLButtonElement>("pinOn").className = "on";
    el<HTMLButtonElement>("pinOff").className = "";
    void invoke("set_always_on_top", { pinned: true }).catch(() => undefined);
  }
} catch { /* 本地存储不可用时忽略 */ }
armIdleTimer();
void initHotkey();
void refreshFavSet();
