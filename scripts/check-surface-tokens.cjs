/**
 * 表面层级检查：找出业务组件里手写的"卡片表面"，防止卡片套卡片。
 *
 * 规则来源：CLAUDE.md「UI Primitive 单点落地」+ skill `henji-ui-surface`。
 * 核心铁律：同一层视觉深度只画一次边框/背景。
 *
 * 两条规则：
 *   A. 手写面板表面（border + bg-panel + rounded）—— 那是 <UiPanel> 的活，任意数量即告警
 *   B. 同一文件出现 >= 2 处卡片表面 —— 高度疑似"卡片套卡片"
 * 单个卡片表面不报（组件自己的根表面是合理的，比如画布节点外壳）。
 *
 * 默认只告警（exit 0），便于存量渐进治理；加 --strict 时违规即失败（exit 1）。
 *
 * 豁免方式：
 *   - 行内或上一行注释包含 `ui-surface-allow`
 *   - 文件任意位置包含 `ui-surface-allow-file`
 */
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');

const targetExtensions = new Set(['.tsx']);

/** UI primitive 自身就是表面的唯一实现处，天然豁免 */
const exemptDirs = [path.join(srcRoot, 'components', 'ui')];

const FILE_ALLOW_MARKER = 'ui-surface-allow-file';
const LINE_ALLOW_MARKER = 'ui-surface-allow';

/** 同一文件允许的卡片表面数量上限；超过即疑似套娃 */
const MAX_CARD_SURFACES_PER_FILE = 1;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectSourceFiles(dir) {
  /** @type {string[]} */
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (targetExtensions.has(path.extname(entry.name))) {
      result.push(fullPath);
    }
  }

  return result;
}

/**
 * 抽取所有 className 取值区域，支持 "..." / '...' / {...}（含跨行模板串）。
 * @param {string} raw
 * @returns {{ value: string, index: number }[]}
 */
function extractClassNameRegions(raw) {
  /** @type {{ value: string, index: number }[]} */
  const regions = [];
  const attrPattern = /className\s*=\s*/g;
  let match;

  while ((match = attrPattern.exec(raw)) !== null) {
    const valueStart = match.index + match[0].length;
    const opener = raw[valueStart];

    if (opener === '"' || opener === "'") {
      const end = raw.indexOf(opener, valueStart + 1);
      if (end === -1) continue;
      regions.push({ value: raw.slice(valueStart + 1, end), index: valueStart });
      attrPattern.lastIndex = end + 1;
      continue;
    }

    if (opener === '{') {
      let depth = 0;
      let cursor = valueStart;
      for (; cursor < raw.length; cursor += 1) {
        if (raw[cursor] === '{') depth += 1;
        else if (raw[cursor] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      regions.push({ value: raw.slice(valueStart + 1, cursor), index: valueStart });
      attrPattern.lastIndex = cursor + 1;
    }
  }

  return regions;
}

/**
 * 把 className 取值拆成裸 Tailwind token：剥掉引号/模板语法、变体前缀（hover: / dark:）与 `!`。
 * @param {string} value
 * @returns {string[]}
 */
function tokenizeClassValue(value) {
  return value
    .split(/[\s`'"{}()]+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const withoutVariants = piece.includes(':') ? piece.slice(piece.lastIndexOf(':') + 1) : piece;
      return withoutVariants.replace(/^!+/, '');
    })
    .filter(Boolean);
}

/** `border` / `border-2` / `border-[1.5px]` / `border-x` 这类真正给出边框宽度的 token */
const BORDER_WIDTH_PATTERN = /^border(?:-[xytrbl])?(?:-(?:[0-8]|\[[^\]]+\]))?$/;
const BORDER_NOOP_TOKENS = new Set(['border-0', 'border-none', 'border-transparent']);
/** 表面色背景（允许 /40 这类透明度后缀） */
const SURFACE_BG_PATTERN = /^bg-(?:panel|surface|surface-dark|app|layer)(?:\/\d{1,3})?$/;
const PANEL_BG_PATTERN = /^bg-panel(?:\/\d{1,3})?$/;
const ROUNDED_PATTERN = /^rounded(?:-.+)?$/;

/**
 * @param {string[]} tokens
 * @returns {{ isCard: boolean, isPanelSurface: boolean }}
 */
function classifySurface(tokens) {
  const hasBorderWidth = tokens.some((token) => BORDER_WIDTH_PATTERN.test(token));
  const hasBorderNoop = tokens.some((token) => BORDER_NOOP_TOKENS.has(token));
  const hasSurfaceBg = tokens.some((token) => SURFACE_BG_PATTERN.test(token));
  const hasRounded = tokens.some((token) => ROUNDED_PATTERN.test(token));

  const isCard = hasBorderWidth && !hasBorderNoop && hasSurfaceBg && hasRounded;
  return {
    isCard,
    isPanelSurface: isCard && tokens.some((token) => PANEL_BG_PATTERN.test(token)),
  };
}

/**
 * @param {string} raw
 * @param {number} index
 * @returns {number}
 */
function lineNumberAt(raw, index) {
  let line = 1;
  for (let i = 0; i < index && i < raw.length; i += 1) {
    if (raw[i] === '\n') line += 1;
  }
  return line;
}

/**
 * @param {string[]} lines
 * @param {number} lineNo
 * @returns {boolean}
 */
function hasLineAllowMarker(lines, lineNo) {
  const current = lines[lineNo - 1] ?? '';
  const previous = lines[lineNo - 2] ?? '';
  return current.includes(LINE_ALLOW_MARKER) || previous.includes(LINE_ALLOW_MARKER);
}

const strict = process.argv.includes('--strict');
const files = collectSourceFiles(srcRoot).filter(
  (file) => !exemptDirs.some((dir) => path.normalize(file).startsWith(path.normalize(dir)))
);

/** @type {{ relativePath: string, panelSurfaces: {lineNo:number,snippet:string}[], cardSurfaces: {lineNo:number,snippet:string}[] }[]} */
const fileReports = [];

/**
 * 规则 C：手写弹窗。
 * 业务组件同时出现全屏遮罩定位（fixed inset-0 / UI_CONTENT_OVERLAY_INSET_CLASS）
 * 与半透明黑底，却没有走 UiModal / AlertDialog，说明自己搭了一套弹窗外壳。
 * 这类实现会各自定义圆角、遮罩透明度、宽度与过渡，是弹窗观感不统一的根源。
 * @type {{ relativePath: string, lineNo: number, snippet: string }[]}
 */
const dialogBypasses = [];

const OVERLAY_POSITION_PATTERN = /fixed\s+inset-0|UI_CONTENT_OVERLAY_INSET_CLASS/;
const OVERLAY_SCRIM_PATTERN = /bg-black\/|bg-black\s+bg-opacity-/;

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.includes(FILE_ALLOW_MARKER)) continue;

  const lines = raw.split(/\r?\n/);

  if (
    OVERLAY_POSITION_PATTERN.test(raw) &&
    OVERLAY_SCRIM_PATTERN.test(raw) &&
    !/\bUiModal\b/.test(raw) &&
    !/\bAlertDialog\b/.test(raw)
  ) {
    // 优先定位真正的遮罩用法行，而不是 import UI_CONTENT_OVERLAY_INSET_CLASS 那一行
    const usageIndex = lines.findIndex(
      (line) => OVERLAY_POSITION_PATTERN.test(line) && !/^\s*import\b/.test(line)
    );
    const hitIndex = usageIndex >= 0
      ? usageIndex
      : lines.findIndex((line) => OVERLAY_POSITION_PATTERN.test(line));
    const lineNo = hitIndex >= 0 ? hitIndex + 1 : 1;
    if (!hasLineAllowMarker(lines, lineNo)) {
      dialogBypasses.push({
        relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'),
        lineNo,
        snippet: (lines[lineNo - 1] ?? '').trim().slice(0, 140),
      });
    }
  }

  /** @type {{lineNo:number,snippet:string}[]} */
  const panelSurfaces = [];
  /** @type {{lineNo:number,snippet:string}[]} */
  const cardSurfaces = [];

  for (const region of extractClassNameRegions(raw)) {
    const { isCard, isPanelSurface } = classifySurface(tokenizeClassValue(region.value));
    if (!isCard) continue;

    const lineNo = lineNumberAt(raw, region.index);
    if (hasLineAllowMarker(lines, lineNo)) continue;

    const entry = { lineNo, snippet: (lines[lineNo - 1] ?? '').trim().slice(0, 140) };
    cardSurfaces.push(entry);
    if (isPanelSurface) panelSurfaces.push(entry);
  }

  const nested = cardSurfaces.length > MAX_CARD_SURFACES_PER_FILE;
  if (panelSurfaces.length === 0 && !nested) continue;

  fileReports.push({
    relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'),
    panelSurfaces,
    cardSurfaces: nested ? cardSurfaces : [],
  });
}

if (fileReports.length === 0 && dialogBypasses.length === 0) {
  console.log('[check-surface-tokens] 通过：未检测到手写面板表面、卡片套卡片或手写弹窗。');
  process.exit(0);
}

const log = strict ? console.error : console.warn;
const header = strict ? '检测到表面层级违规' : '检测到表面层级问题（告警，不阻断）';
log(`\n[check-surface-tokens] ${header}：\n`);

let totalFindings = 0;

for (const report of fileReports.sort(
  (a, b) => b.panelSurfaces.length + b.cardSurfaces.length - (a.panelSurfaces.length + a.cardSurfaces.length)
)) {
  log(report.relativePath);

  if (report.panelSurfaces.length > 0) {
    log(`  [A] 手写面板表面 ${report.panelSurfaces.length} 处 → 请改用 <UiPanel>`);
    for (const item of report.panelSurfaces) {
      log(`      :${item.lineNo}  ${item.snippet}`);
      totalFindings += 1;
    }
  }

  if (report.cardSurfaces.length > 0) {
    log(`  [B] 同文件 ${report.cardSurfaces.length} 处卡片表面 → 疑似卡片套卡片，内层改用 UiPanel variant="inset"/"bare" 或纯留白`);
    for (const item of report.cardSurfaces) {
      log(`      :${item.lineNo}  ${item.snippet}`);
    }
    totalFindings += report.cardSurfaces.length;
  }

  log('');
}

if (dialogBypasses.length > 0) {
  log(`[C] 手写弹窗 ${dialogBypasses.length} 处 → 请改用 <UiModal> 或 <AlertDialog>`);
  for (const item of dialogBypasses.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    log(`      ${item.relativePath}:${item.lineNo}  ${item.snippet}`);
  }
  totalFindings += dialogBypasses.length;
  log('');
}

log(`共 ${totalFindings} 处：表面问题 ${fileReports.length} 个文件，手写弹窗 ${dialogBypasses.length} 处。`);
log('铁律：同一层视觉深度只画一次边框/背景。组件根表面只允许一处；确需例外时加 `ui-surface-allow` 注释豁免。');
log('详细规则见 skill `henji-ui-surface`。\n');

process.exit(strict ? 1 : 0);
