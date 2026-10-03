const fs = require('fs');
const path = require('path');

/*
 * 颜色令牌检查（npm run check:colors，build / electron:build / CI 门禁）。
 *
 * 一、硬性规则（全部 .ts/.tsx/.css，任何新增都失败，不可登记）：
 *   - 十六进制颜色字面量、Tailwind 任意十六进制颜色类；
 *   - 纯 CSS 里的 rgb()/rgba() 字面量（只能写 rgb(var(--xxx-rgb) / a) 或引用令牌变量）；
 *   - 已删除的旧 CSS 变量别名（--app-rgb、--text-muted-rgb、--ui-surface-panel …，界面重设计 4.2），
 *     令牌定义处 index.css 也查。
 *
 * 二、语义令牌规则（ts/tsx，非测试文件；界面重设计 1.3 新增，4.2 收紧）：
 *   - palette：固定调色板类（bg-red-500、text-emerald-300 …），不随主题；
 *   - mono：黑白类（text-white、bg-black/40、border-white/10 …），浅色主题下失效；
 *   - rgba：rgb()/rgba() 数字字面量；
 *   - named：命名色（color: 'white'、fill="black" …）；
 *   - legacy：旧令牌别名类（bg-app、text-text-muted、border-border-dark、text-brand-300、text-danger …）。
 *   界面色改用语义令牌类（bg-panel、text-text2、text-on-accent、bg-danger-solid、border-media-line …，
 *   见 tailwind.config.js）；内容色（标注默认色、导出图配色、算法遮罩等）在 colorTokens.ts 登记常量。
 *
 * 三、存量登记 scripts/check-color-tokens.allowlist.json（每条写明归属与类别）：
 *   - 某文件某规则的数量超过登记数即失败；低于登记数时提示下调，`--shrink-allowlist` 只会往下收；
 *   - 已清零的规则（NON_REGISTRABLE_RULES）不可再登记，登记文件里出现即失败；
 *   - 其余规则的登记总数不得超过本文件的 ALLOWLIST_CEILING（只能下调；调高必须改本脚本，评审可见）。
 */

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const allowlistFile = path.join(projectRoot, 'scripts', 'check-color-tokens.allowlist.json');
const shrinkAllowlist = process.argv.includes('--shrink-allowlist');

// 颜色令牌的定义处，允许写字面量
const definitionFiles = new Set(
  [
    path.join(srcRoot, 'core', 'theme', 'colorTokens.ts'),
    path.join(srcRoot, 'index.css'),
  ].map((file) => path.normalize(file))
);
// 只豁免语义令牌规则的定义/参考实现（主题引擎按种子计算 rgba；设计稿参考实现仅供测试对照）
const semanticRuleExemptFiles = new Set(
  [
    path.join(srcRoot, 'core', 'theme', 'themeEngine.ts'),
    path.join(srcRoot, 'core', 'theme', 'themeReferenceTestFixture.ts'),
  ].map((file) => path.normalize(file))
);

// .css 也要扫：此前只扫 .ts/.tsx，导致 7 个样式表里累计 70 处硬编码颜色长期不被发现，
// 其中包含 8 处 `#007eff`（一个和应用强调色 #3b82f6 不同的蓝）和一组亮色主题回退值
// （`--color-*` 变量从未定义，回退到 #ffffff/#18181b，在深色应用里就是白底黑字）。
const targetExtensions = new Set(['.ts', '.tsx', '.css']);
// CSS 里的 rgb()/rgba() 字面量：只有 rgb(var(--x-rgb) / a) 形式才允许
const cssRawRgbPattern = /\brgba?\(\s*[0-9]/g;
const hexColorPattern = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const arbitraryTailwindHexPattern = /(bg|text|border|ring|accent)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g;

const UTILITY_PREFIX = '(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)';
// 已删除的旧令牌别名颜色名（1.3 过渡别名，4.2 从 tailwind.config.js 删除；DEFAULT 别名 bg/surface/border/text 也算）
const LEGACY_ALIAS_COLOR_NAMES =
  'bg-dark|bg|surface-dark|surface|border-dark|border|app|layer|brand-\\d{3}|text-dark|text|text-muted(?:-dark)?|text-soft(?:-dark)?|text-faint(?:-dark)?|danger|success|warning';
const PALETTE_NAMES = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';
/** @type {Record<string, { pattern: RegExp, label: string }>} */
const SEMANTIC_RULES = {
  palette: {
    pattern: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*!?-?${UTILITY_PREFIX}-(?:${PALETTE_NAMES})-\\d{2,3}\\b`, 'g'),
    label: '固定调色板类不随主题，请改用语义令牌类（状态用 text-danger-text / bg-danger-tint 等）',
  },
  mono: {
    pattern: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*!?${UTILITY_PREFIX}-(?:white|black)(?![\\w-])`, 'g'),
    label: '黑白类在浅色主题下失效：界面面上用 text-text1 / bg-panel 等，压在媒体上用 text-on-media / bg-media-control / border-media-line',
  },
  rgba: {
    pattern: /\brgba?\(\s*\d/g,
    label: 'rgb()/rgba() 字面量：界面色用语义令牌，内容色登记到 colorTokens.ts',
  },
  named: {
    pattern: /\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*[:=]\s*['"`](?:white|black|red|green|blue|yellow|orange|gray|grey|purple)['"`]/g,
    label: '命名色：界面色用语义令牌，内容色登记到 colorTokens.ts',
  },
  legacy: {
    pattern: new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*!?-?${UTILITY_PREFIX}-(?:${LEGACY_ALIAS_COLOR_NAMES})(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]]+\\]))?(?![\\w-])`,
      'g'
    ),
    label:
      '旧令牌别名类已删除（界面重设计 4.2）：bg-bg-dark→bg-gap、bg-app→bg-window、bg-surface-dark→bg-raised、bg-layer→bg-hover、' +
      'border-border-dark→border-line、text-text(-dark)→text-text1、text-text-muted/soft→text-text2、text-text-faint→text-text3、' +
      'brand-300→accent-text、brand-500→accent、brand-600/700→accent-pressed、text-danger/success/warning→*-text（实底 *-solid）',
  },
};

/** 已清零、不可再登记的语义规则：登记文件里出现即失败。 */
const NON_REGISTRABLE_RULES = new Set(['palette', 'mono', 'named']);
/**
 * 可登记规则的登记总数上限（只能下调）。
 * - rgba：剪辑引擎验收探针里的着色器源码文本（非界面色）；
 * - legacy：4.2 别名迁移前的过渡存量（迁移完成后改为 0 并移入 NON_REGISTRABLE_RULES）。
 */
const ALLOWLIST_CEILING = { rgba: 1, legacy: 632 };

// 已删除的旧 CSS 变量别名（1.1 第七节 → 4.2 删除）。--danger/success/warning-rgb 现在是实底三元组，不在此列。
const legacyCssVarPattern =
  /--(?:app|bg|surface|layer|border|text|text-soft|text-muted|text-faint|brand-\d{3})-rgb\b|--ui-(?:surface-panel|surface-field|border-soft|border-strong)\b/g;

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
    const ext = path.extname(entry.name);
    if (targetExtensions.has(ext)) {
      result.push(fullPath);
    }
  }

  return result;
}

/** @param {string} fullPath */
function toRelative(fullPath) {
  return path.relative(projectRoot, fullPath).replace(/\\/g, '/');
}

/**
 * @param {string} fullPath
 * @param {number} lineNo
 * @param {string} line
 * @param {string} reason
 */
function formatViolation(fullPath, lineNo, line, reason) {
  return `${toRelative(fullPath)}:${lineNo} ${reason}\n  ${line.trim()}`;
}

/** @param {string} file */
function isSemanticRuleTarget(file) {
  const ext = path.extname(file);
  if (ext !== '.ts' && ext !== '.tsx') return false;
  if (/\.test\.[tj]sx?$/.test(file) || file.split(path.sep).includes('tests')) return false;
  return !semanticRuleExemptFiles.has(path.normalize(file));
}

function readAllowlist() {
  const raw = JSON.parse(fs.readFileSync(allowlistFile, 'utf8'));
  if (raw.version !== 1 || typeof raw.files !== 'object') {
    throw new Error(`${toRelative(allowlistFile)} 格式不正确（需要 version: 1 与 files）`);
  }
  return raw;
}

const allSourceFiles = collectSourceFiles(srcRoot);
const files = allSourceFiles.filter((file) => !definitionFiles.has(path.normalize(file)));
/** @type {string[]} */
const violations = [];

// 旧 CSS 变量别名：定义处（index.css）也查；测试里拿它们当样例文本的不算。
for (const file of allSourceFiles) {
  if (/\.test\.[tj]sx?$/.test(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    const matches = line.match(legacyCssVarPattern);
    if (matches) {
      violations.push(
        formatViolation(file, index + 1, line, `旧 CSS 变量别名已删除（${matches.join(' ')}）：改用新语义变量（--window-rgb、--text2-rgb、--panel …）`)
      );
    }
  });
}
/** @type {Map<string, { counts: Record<string, number>, lines: Record<string, string[]> }>} */
const semanticUsage = new Map();

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const semantic = isSemanticRuleTarget(file);
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, string[]>} */
  const ruleLines = {};

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index];

    // 纯注释行放过：记录"原先硬编码的是哪个值、为什么改掉"是有用的文档，
    // 而一整行都是注释时不可能存在真实的颜色使用。
    // 只放过整行注释，不放过 `color: #fff; /* ... */` 这种行尾注释。
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) {
      continue;
    }

    if (arbitraryTailwindHexPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止使用 Tailwind 任意十六进制颜色类'));
    }
    arbitraryTailwindHexPattern.lastIndex = 0;

    if (hexColorPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止直接写十六进制颜色'));
    }
    hexColorPattern.lastIndex = 0;

    // CSS 额外查 rgb()/rgba() 字面量
    if (path.extname(file) === '.css' && cssRawRgbPattern.test(line)) {
      violations.push(
        formatViolation(file, lineNo, line, '禁止 rgb/rgba 字面量，请写 rgb(var(--xxx-rgb) / a)')
      );
    }
    cssRawRgbPattern.lastIndex = 0;

    if (semantic) {
      for (const [rule, { pattern }] of Object.entries(SEMANTIC_RULES)) {
        const matches = line.match(pattern);
        if (!matches) continue;
        counts[rule] = (counts[rule] ?? 0) + matches.length;
        (ruleLines[rule] ??= []).push(`  ${lineNo}: ${matches.join(' ')}`);
      }
    }
  }

  if (Object.keys(counts).length > 0) {
    semanticUsage.set(toRelative(file), { counts, lines: ruleLines });
  }
}

const allowlist = readAllowlist();
/** @type {string[]} */
const shrinkable = [];
/** @type {string[]} */
const semanticViolations = [];

// 登记文件本身的约束：不可登记的规则不得出现；可登记规则的总数不得超过脚本里的上限（只能下调）。
/** @type {Record<string, number>} */
const registeredByRule = {};
for (const [file, entry] of Object.entries(allowlist.files)) {
  for (const [rule, allowed] of Object.entries(entry.counts ?? {})) {
    if (!(rule in SEMANTIC_RULES)) {
      semanticViolations.push(`${toRelative(allowlistFile)}：${file} 登记了未知规则 ${rule}`);
    } else if (NON_REGISTRABLE_RULES.has(rule)) {
      semanticViolations.push(`${toRelative(allowlistFile)}：${file} 登记了已清零、不可再登记的规则 ${rule}（${SEMANTIC_RULES[rule].label}）`);
    }
    registeredByRule[rule] = (registeredByRule[rule] ?? 0) + allowed;
  }
}
for (const [rule, total] of Object.entries(registeredByRule)) {
  const ceiling = ALLOWLIST_CEILING[rule] ?? 0;
  if (!NON_REGISTRABLE_RULES.has(rule) && total > ceiling) {
    semanticViolations.push(
      `${toRelative(allowlistFile)}：规则 ${rule} 登记 ${total} 处，超过上限 ${ceiling}（登记只能下调，不得为通过检查而调高）`
    );
  }
}

for (const [file, usage] of semanticUsage) {
  const entry = allowlist.files[file];
  for (const [rule, count] of Object.entries(usage.counts)) {
    const allowed = entry?.counts?.[rule] ?? 0;
    if (count > allowed) {
      semanticViolations.push(
        `${file} [${rule}] ${count} 处，登记 ${allowed} 处${entry ? `（归属 ${entry.owner}，${entry.category}）` : '（未登记）'}\n` +
          `  ${SEMANTIC_RULES[rule].label}\n${usage.lines[rule].join('\n')}`
      );
    }
  }
}

for (const [file, entry] of Object.entries(allowlist.files)) {
  const usage = semanticUsage.get(file);
  for (const [rule, allowed] of Object.entries(entry.counts ?? {})) {
    const count = usage?.counts?.[rule] ?? 0;
    if (count < allowed) shrinkable.push(`${file} [${rule}] 实际 ${count}，登记 ${allowed}`);
  }
}

if (shrinkAllowlist) {
  /** @type {Record<string, unknown>} */
  const nextFiles = {};
  for (const [file, entry] of Object.entries(allowlist.files)) {
    const usage = semanticUsage.get(file);
    /** @type {Record<string, number>} */
    const counts = {};
    for (const [rule, allowed] of Object.entries(entry.counts ?? {})) {
      const next = Math.min(allowed, usage?.counts?.[rule] ?? 0);
      if (next > 0) counts[rule] = next;
    }
    if (Object.keys(counts).length > 0) nextFiles[file] = { ...entry, counts };
  }
  fs.writeFileSync(allowlistFile, `${JSON.stringify({ ...allowlist, files: nextFiles }, null, 2)}\n`);
  console.log(`[check-color-tokens] 已收紧登记：${shrinkable.length} 项下调，未放宽任何条目。`);
}

if (violations.length > 0 || semanticViolations.length > 0) {
  if (violations.length > 0) {
    console.error('\n[check-color-tokens] 检测到颜色规范违规：\n');
    for (const item of violations) {
      console.error(item);
    }
    console.error(`\n共 ${violations.length} 处违规。颜色只允许在 src/index.css / tailwind.config.js / src/core/theme/colorTokens.ts 三处定义；
其余位置请用语义化 Tailwind 类或 rgb(var(--xxx-rgb) / a)。\n`);
  }
  if (semanticViolations.length > 0) {
    console.error('\n[check-color-tokens] 新增了不随主题的颜色写法（超出存量登记）：\n');
    for (const item of semanticViolations) {
      console.error(item);
    }
    console.error(`\n共 ${semanticViolations.length} 项超出登记。请改用语义令牌类；确属内容色时在 colorTokens.ts 登记常量。
不要为了通过检查而调高 ${toRelative(allowlistFile)} 的登记数。\n`);
  }
  process.exit(1);
}

if (shrinkable.length > 0 && !shrinkAllowlist) {
  console.log(`[check-color-tokens] 提示：${shrinkable.length} 项存量已减少，可运行 \`node scripts/check-color-tokens.cjs --shrink-allowlist\` 收紧登记：`);
  for (const item of shrinkable) console.log(`  ${item}`);
}

const registered = Object.values(allowlist.files).reduce(
  (sum, entry) => sum + Object.values(entry.counts ?? {}).reduce((a, b) => a + b, 0),
  0
);
console.log(`[check-color-tokens] 通过：无硬编码颜色；不随主题的写法未超出存量登记（登记 ${registered} 处，${Object.keys(allowlist.files).length} 个文件）。`);
