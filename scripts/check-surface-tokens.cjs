/* eslint-disable @typescript-eslint/no-var-requires, no-console -- Node CLI 门禁使用 CommonJS，并向 CI 输出诊断。 */
/**
 * 表面层级检查：找出业务组件里手写的"卡片表面"，防止卡片套卡片。
 *
 * 规则来源：docs/rules/architecture.md「单点落地约定」+ skill `henji-ui-surface`。
 * 核心铁律：同一层视觉深度只画一次边框/背景。
 *
 * 表面规则 A–E，加静态语法 S1–S5/S7–S10（S6 属于 check:icons）：
 *   A. 手写面板表面（border + bg-panel + rounded）—— 那是 <UiPanel> 的活，任意数量即告警
 *   B. 同一文件出现 >= 2 处卡片表面 —— 高度疑似"卡片套卡片"
 *   C. 手写弹窗（同一元素 fixed inset-0 + 遮罩或模态语义，未由 UiModal/AlertDialog 承载）
 *   D. `.css` 里手写毛玻璃（backdrop-filter），绕开 `.ui-glass`
 *   E. 按钮、选项、标签、导航与字段触发器的调用点覆盖外观（底色/边框/文字色/圆角/阴影/高度/字号），见 lib/buttonAppearanceOverrides.cjs
 * A 对手写面板任意数量报错；B 只对同文件多处通用卡片报错。S8 的禁用原因与手写 alert 建议只告警。
 *
 * 规则 D 的由来：ESLint 只拦得住 `backdrop-blur-*` 工具类，拦不住 CSS 文件里直接写
 * `backdrop-filter`。实测 `.context-menu` 与 `.speed-menu` 就是这么各抄了一份玻璃，
 * 都抄漏了噪点层，`.context-menu` 还用第二条 box-shadow 把受光内阴影整条顶掉了。
 * 正确做法是在元素上加 `ui-glass` 类，CSS 只留布局。
 *
 * 默认严格门禁（exit 1）；--report 显式选择告警视图，--strict 保留为明确的严格入口。
 *
 * 豁免方式：只有行级——行内或上一行注释包含 `ui-surface-allow` 并写明理由与接手任务。
 * 文件级 `ui-surface-allow-file` 已禁止（会把该文件将来真正的套娃一起放行），出现即报违规（4.2）。
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { findButtonAppearanceOverrides, findButtonAppearanceOverridesInSource, collectConstants, collectStrings, collectImportedConstants, getSurfaceAllowComments } = require('./lib/buttonAppearanceOverrides.cjs');
const { findUiSurfaceGrammar } = require('./lib/uiSurfaceGrammar.cjs');

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');

const targetExtensions = new Set(['.tsx', '.ts']);

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
/**
 * 表面色背景（允许 /40 这类透明度后缀）。语义令牌：panel 面板、raised 内嵌/字段、window 窗口、hover 悬停底
 * （4.2 删除旧别名 surface/surface-dark/app/layer 后对应的新名，覆盖范围不变）。
 */
const SURFACE_BG_PATTERN = /^bg-(?:panel|raised|window|hover)(?:\/\d{1,3})?$/;
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
function hasLineAllowMarker(comments, lineNo) {
  return comments.some(comment => comment.line === lineNo || comment.line === lineNo - 1);
}

function allowComments(raw, file) {
  if (file.endsWith('.css')) return [...raw.matchAll(/\/\*[\s\S]*?\*\//g)]
    .filter(match => /ui-surface-allow(?!-file)/.test(match[0]))
    .map(match => ({ start: match.index, end: match.index + match[0].length, line: lineNumberAt(raw, match.index), text: match[0] }));
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return getSurfaceAllowComments(raw, sf);
}

/** TS 中 Class / *_CLASS 声明也属于表面入口；引用已声明完整表面的派生布局不重复计数。 */
function extractTsClassRegions(raw, file) {
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const local = collectConstants(sf), imported = collectImportedConstants(sf, file, srcRoot);
  const declarations = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /(?:Class|_CLASS)$/.test(node.name.text)) {
      declarations.push({ name: node.name.text, node, value: collectStrings(node.initializer, [local, imported]).join(' ') });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const cards = new Map(declarations.map(entry => [entry.name, classifySurface(tokenizeClassValue(entry.value))]).filter(([, surface]) => surface.isCard));
  return declarations.filter(entry => {
    const surface = classifySurface(tokenizeClassValue(entry.value));
    let inherited = false;
    const inspect = node => { if (ts.isIdentifier(node) && cards.has(node.text) && node.text !== entry.name && cards.get(node.text).isPanelSurface === surface.isPanelSurface) inherited = true; ts.forEachChild(node, inspect); };
    inspect(entry.node.initializer);
    return !inherited;
  }).map(entry => ({ value: entry.value, index: entry.node.getStart(sf) }));
}

const surfaceRegions = (raw, file) => file.endsWith('.ts') ? extractTsClassRegions(raw, file) : extractClassNameRegions(raw);

const cli = { strict: true, files: [] };
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--strict') cli.strict = true;
  else if (arg === '--report') cli.strict = false;
  else if (arg === '--files') {
    const value = process.argv[++index];
    if (!value || value.startsWith('--')) throw new Error('--files 缺少文件列表');
    for (const item of value.split(',').filter(Boolean)) {
      const file = path.resolve(projectRoot, item);
      const relative = path.relative(srcRoot, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.(tsx?|css)$/.test(file) || !fs.statSync(file).isFile()) {
        throw new Error(`--files 只接受 src 内已有的 .ts/.tsx/.css 文件：${item}`);
      }
      cli.files.push(file);
    }
    if (!cli.files.length) throw new Error('--files 文件列表不能为空');
  } else throw new Error(`未知参数：${arg}`);
}
if (process.argv.includes('--strict') && process.argv.includes('--report')) throw new Error('--strict 与 --report 不能同用');
const strict = cli.strict;
const selected = new Set(cli.files);
const inScope = file => selected.size === 0 || selected.has(file);
const files = collectSourceFiles(srcRoot).filter(
  (file) => inScope(file) && !/\.(test|spec)\.tsx?$/.test(file)
    && !exemptDirs.some((dir) => path.relative(dir, file) === '' || !path.relative(dir, file).startsWith('..') && !path.isAbsolute(path.relative(dir, file)))
);

/** @type {{ relativePath: string, panelSurfaces: {lineNo:number,snippet:string}[], cardSurfaces: {lineNo:number,snippet:string}[] }[]} */
const fileReports = [];

/**
 * 规则 C：手写弹窗。
 * 同一元素出现全屏定位（fixed inset-0 / UI_CONTENT_OVERLAY_INSET_CLASS）
 * 与遮罩或模态语义，且不在 UiModal / AlertDialog 子树内，说明自己搭了一套弹窗外壳。
 * 这类实现会各自定义圆角、遮罩透明度、宽度与过渡，是弹窗观感不统一的根源。
 * @type {{ relativePath: string, lineNo: number, snippet: string }[]}
 */
const dialogBypasses = [];

/** 只检查同一元素的遮罩结构，组件子树由正式模态容器负责时不重复判定。 */
function findDialogBypasses(raw, file) {
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = raw.split(/\r?\n/);
  const comments = allowComments(raw, file);
  const hits = [];
  const scopes = [collectConstants(sf), collectImportedConstants(sf, file, srcRoot)];
  const modalNames = new Set(['UiModal', 'AlertDialog']);
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const binding of statement.importClause.namedBindings.elements) {
      if (modalNames.has((binding.propertyName ?? binding.name).text)) modalNames.add(binding.name.text);
    }
  }
  const visit = (node, modalOwner = false) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText(sf);
      const owned = modalOwner || modalNames.has(name);
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
      const classes = attributes.find(attr => attr.name.getText(sf) === 'className');
      const value = classes?.initializer?.getText(sf) ?? '';
      const tokens = collectStrings(classes?.initializer, scopes).flatMap(tokenizeClassValue);
      const fullScreen = tokens.includes('fixed') && (tokens.includes('inset-0') || value.includes('UI_CONTENT_OVERLAY_INSET_CLASS'));
      const scrim = tokens.some(token => /^(?:bg-scrim(?:-|\/|$)|bg-(?:media|black)(?:\/|$)|ui-glass-scrim(?:-|$))/.test(token));
      const dialog = attributes.some(attr => attr.name.getText(sf) === 'role' && /["']dialog["']/.test(attr.initializer?.getText(sf) ?? '')
        || attr.name.getText(sf) === 'aria-modal' && /\btrue\b/.test(attr.initializer?.getText(sf) ?? ''));
      if (!owned && fullScreen && (scrim || dialog)) {
        const lineNo = sf.getLineAndCharacterOfPosition(classes.getStart(sf)).line + 1;
        if (!hasLineAllowMarker(comments, lineNo)) hits.push({ lineNo, snippet: lines[lineNo - 1].trim().slice(0, 140) });
      }
      if (ts.isJsxElement(node)) for (const child of node.children) visit(child, owned);
      return;
    }
    ts.forEachChild(node, child => visit(child, modalOwner));
  };
  visit(sf);
  return hits;
}

/**
 * 规则 D：`.css` 里手写毛玻璃。
 * 唯一允许出现 backdrop-filter 的地方是 src/index.css 中 `.ui-glass` / `.ui-glass-scrim`
 * 这两个材质定义本身；其余任何 CSS 文件里出现即为绕开材质单点。
 * @type {{ relativePath: string, lineNo: number, snippet: string }[]}
 */
const handRolledGlass = [];

const GLASS_DEFINITION_FILE = path.join(srcRoot, 'index.css');
const BACKDROP_FILTER_PATTERN = /backdrop-filter\s*:/;

/** @param {string} dir @returns {string[]} */
function collectStyleSheets(dir) {
  /** @type {string[]} */
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectStyleSheets(fullPath));
    } else if (path.extname(entry.name) === '.css') {
      result.push(fullPath);
    }
  }
  return result;
}

for (const file of collectStyleSheets(srcRoot).filter(inScope)) {
  // 材质定义处天然豁免：`.ui-glass` / `.ui-glass-scrim` 就住在这里
  if (path.normalize(file) === path.normalize(GLASS_DEFINITION_FILE)) continue;

  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/), comments = allowComments(raw, file);
  lines.forEach((line, index) => {
    if (!BACKDROP_FILTER_PATTERN.test(line)) return;
    if (hasLineAllowMarker(comments, index + 1)) return;
    handRolledGlass.push({
      relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'),
      lineNo: index + 1,
      snippet: line.trim().slice(0, 140),
    });
  });
}

/** 使用了已禁止的文件级豁免标记的文件 */
const fileLevelAllows = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.includes(FILE_ALLOW_MARKER)) {
    fileLevelAllows.push(path.relative(projectRoot, file).replace(/\\/g, '/'));
  }

  const lines = raw.split(/\r?\n/);
  const comments = allowComments(raw, file);

  for (const hit of findDialogBypasses(raw, file)) dialogBypasses.push({
    relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'), ...hit,
  });

  /** @type {{lineNo:number,snippet:string}[]} */
  const panelSurfaces = [];
  /** @type {{lineNo:number,snippet:string}[]} */
  const cardSurfaces = [];

  for (const region of surfaceRegions(raw, file)) {
    const { isCard, isPanelSurface } = classifySurface(tokenizeClassValue(region.value));
    if (!isCard) continue;

    const lineNo = lineNumberAt(raw, region.index);
    if (hasLineAllowMarker(comments, lineNo)) continue;

    const entry = { lineNo, snippet: (lines[lineNo - 1] ?? '').trim().slice(0, 140) };
    cardSurfaces.push(entry);
    if (isPanelSurface) panelSurfaces.push(entry);
  }

  /*
   * `<UiPanel>` 的默认 variant 就是一张完整卡片，混着手写卡片用时要一起计入套娃计数。
   *
   * 漏掉这条踩过一次：AgentModelProfilesSection 是 `<UiPanel>` 外壳里再套一张手写卡片，
   * 手写的只有 1 处、正好卡在上限里，规则 B 全绿放行——界面上却是明显的卡片套卡片。
   *
   * 为什么要"文件里已经有手写卡片"这个前提：只用 `<UiPanel>` 的文件里，多张卡片
   * 绝大多数是并列的列表项或互斥的浮层（实测 3 个文件全是），无条件计数只会制造噪音。
   * 而"组件卡片 + 手写卡片"混用，几乎一定是外壳套内层的那种嵌套。
   * `variant=` 带值的（inset / bare / glass）不是卡片，不计。
   */
  if (cardSurfaces.length > 0) {
    for (const match of raw.matchAll(/<UiPanel(\s[^>]*)?>/g)) {
      const attrs = match[1] ?? '';
      if (/\bvariant\s*=/.test(attrs)) continue;
      const lineNo = lineNumberAt(raw, match.index ?? 0);
      if (hasLineAllowMarker(comments, lineNo)) continue;
      cardSurfaces.push({ lineNo, snippet: (lines[lineNo - 1] ?? '').trim().slice(0, 140) });
    }
  }

  const nested = cardSurfaces.length > MAX_CARD_SURFACES_PER_FILE;
  if (panelSurfaces.length === 0 && !nested) continue;

  fileReports.push({
    relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'),
    panelSurfaces,
    cardSurfaces: nested ? cardSurfaces : [],
  });
}

/*
 * 规则 E：按钮外观覆盖。组件目录也要查（Dropdown、AlertDialog 等都在调用按钮），只豁免定义处 primitives.tsx。
 */
const buttonOverrides = findButtonAppearanceOverrides({
  srcRoot,
  projectRoot,
  files: collectSourceFiles(srcRoot).filter(file => inScope(file) && file.endsWith('.tsx')),
});

const grammarFindings = collectSourceFiles(srcRoot)
  .filter(file => inScope(file) && file.endsWith('.tsx') && !/\.(?:test|spec)\.tsx$/.test(file))
  .flatMap(file => findUiSurfaceGrammar(fs.readFileSync(file, 'utf8'), file)
    .map(finding => ({ ...finding, relativePath: path.relative(projectRoot, file).replace(/\\/g, '/') })));
for (const finding of grammarFindings) {
  const logFinding = finding.severity === 'warning' ? console.warn : console.error;
  logFinding(`[${finding.rule}${finding.severity === 'warning' ? ' 告警' : ''}] ${finding.relativePath}:${finding.lineNo} ${finding.message}`);
}
const grammarErrors = grammarFindings.filter(finding => finding.severity === 'error');

/** 每个注释都要能抑制当前 A–E 或界面语法命中，删除违规后必须同时删除标记。 */
const allowProblems = [];
const lifecycleFiles = [...collectSourceFiles(srcRoot), ...collectStyleSheets(srcRoot)]
  .filter(file => inScope(file) && !/\.(?:test|spec)\.tsx?$/.test(file));
for (const file of lifecycleFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes(LINE_ALLOW_MARKER)) continue;
  const comments = allowComments(raw, file);
  if (!comments.length) continue;
  let unmarked = raw;
  for (const comment of [...comments].reverse()) unmarked = unmarked.slice(0, comment.start)
    + unmarked.slice(comment.start, comment.end).replace(/ui-surface-allow/g, 'retired-marker  ') + unmarked.slice(comment.end);
  const hits = [];
  const isUiDefinition = exemptDirs.some(dir => !path.relative(dir, file).startsWith('..') && !path.isAbsolute(path.relative(dir, file)));
  if (file.endsWith('.css')) {
    if (file !== GLASS_DEFINITION_FILE) unmarked.split(/\r?\n/).forEach((line, index) => { if (BACKDROP_FILTER_PATTERN.test(line)) hits.push({ line: index + 1 }); });
  } else {
    if (!isUiDefinition) {
      const cards = surfaceRegions(unmarked, file).filter(region => classifySurface(tokenizeClassValue(region.value)).isCard);
      const panelCount = [...unmarked.matchAll(/<UiPanel(\s[^>]*)?>/g)].filter(match => !/\bvariant\s*=/.test(match[1] ?? '')).length;
      for (const region of cards) if (classifySurface(tokenizeClassValue(region.value)).isPanelSurface || cards.length + panelCount > MAX_CARD_SURFACES_PER_FILE) hits.push({ line: lineNumberAt(unmarked, region.index) });
      if (file.endsWith('.tsx')) for (const item of findDialogBypasses(unmarked, file)) hits.push({ line: item.lineNo });
    }
    if (file.endsWith('.tsx')) {
      if (file !== path.join(srcRoot, 'components/ui/primitives.tsx')) hits.push(...findButtonAppearanceOverridesInSource(unmarked, file, undefined, srcRoot));
      hits.push(...findUiSurfaceGrammar(unmarked, file).map(item => ({ line: item.lineNo })));
    }
  }
  for (const comment of comments) {
    const reason = comment.text.split(/ui-surface-allow\s*[:：]?/)[1]?.replace(/\*\/|\}\s*$/g, '').trim() ?? '';
    const active = hits.some(hit => comment.line === hit.line || comment.line === hit.line - 1 || hit.endLine && comment.line >= hit.line && comment.line <= hit.endLine);
    if (reason.length < 8 || !active) allowProblems.push({ relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'), lineNo: comment.line, message: reason.length < 8 ? '豁免理由少于8字' : '过期豁免：该注释已无对应规则命中' });
  }
}

// 只降不升；新增预算必须修改本脚本，不能只扩 allowlist 绕过审查。
const RESIDUE_ALLOWLIST_CEILING = { entries: 34, values: 76, cssClasses: 13, names: 36 };
const allowlistBudgetErrors = [];
const residueAllowlistFile = path.join(projectRoot, 'scripts/ui-residue.allowlist.json');
if (fs.existsSync(residueAllowlistFile)) {
  const allowlist = JSON.parse(fs.readFileSync(residueAllowlistFile, 'utf8'));
  const counts = { entries: allowlist.entries.length, values: allowlist.entries.reduce((total, item) => total + item.values.length, 0),
    cssClasses: allowlist.cssClasses.length, names: allowlist.cssClasses.reduce((total, item) => total + item.names.length, 0) };
  for (const [name, limit] of Object.entries(RESIDUE_ALLOWLIST_CEILING)) if (counts[name] > limit) allowlistBudgetErrors.push(`residue allowlist ${name} ${counts[name]} 超过上限 ${limit}`);
}

if (
  fileReports.length === 0 &&
  dialogBypasses.length === 0 &&
  handRolledGlass.length === 0 &&
  buttonOverrides.length === 0 &&
  fileLevelAllows.length === 0 && allowProblems.length === 0 && allowlistBudgetErrors.length === 0
) {
  console.log(`[check-surface-tokens] 原有表面规则通过；界面语法错误 ${grammarErrors.length} 处，启发式告警 ${grammarFindings.length - grammarErrors.length} 处。`);
  process.exit(strict && grammarErrors.length > 0 ? 1 : 0);
}

const log = strict ? console.error : console.warn;
const header = strict ? '检测到表面层级违规' : '检测到表面层级问题（告警，不阻断）';
log(`\n[check-surface-tokens] ${header}：\n`);

let totalFindings = 0;

for (const item of allowProblems) log(`[豁免] ${item.relativePath}:${item.lineNo} ${item.message}`);
for (const error of allowlistBudgetErrors) log(`[登记] ${error}`);
totalFindings += allowProblems.length + allowlistBudgetErrors.length;

if (fileLevelAllows.length > 0) {
  log(`[豁免] 文件级 ${FILE_ALLOW_MARKER} 已禁止 ${fileLevelAllows.length} 处 → 改为在具体行上方写 ${LINE_ALLOW_MARKER} 并注明理由与接手任务`);
  for (const relativePath of fileLevelAllows) log(`      ${relativePath}`);
  totalFindings += fileLevelAllows.length;
  log('');
}

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

if (handRolledGlass.length > 0) {
  log(`[D] CSS 手写毛玻璃 ${handRolledGlass.length} 处 → 请在元素上加 \`ui-glass\` 类，CSS 只留布局`);
  for (const item of handRolledGlass.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    log(`      ${item.relativePath}:${item.lineNo}  ${item.snippet}`);
  }
  totalFindings += handRolledGlass.length;
  log('');
}

if (buttonOverrides.length > 0) {
  log(`[E] 按钮/选项/标签/导航/字段触发器调用点覆盖外观 ${buttonOverrides.length} 处 → 外观只用组件的 variant/size/tone/on/shape/active 等枚举；className（下拉与面板触发器是 buttonClassName）只放布局`);
  for (const item of buttonOverrides) {
    const detail = item.violations.map((violation) => `${violation.token}（${violation.kind}）`).join(' ');
    log(`      ${item.relativePath}:${item.line}  <${item.component}> ${detail}`);
  }
  totalFindings += buttonOverrides.length;
  log('');
}

log(`共 ${totalFindings} 处：表面问题 ${fileReports.length} 个文件，手写弹窗 ${dialogBypasses.length} 处，手写毛玻璃 ${handRolledGlass.length} 处，按钮外观覆盖 ${buttonOverrides.length} 处，文件级豁免 ${fileLevelAllows.length} 处。`);
log('铁律：同一层视觉深度只画一次边框/背景。组件根表面只允许一处；确需例外时加 `ui-surface-allow` 注释豁免。');
log('详细规则见 skill `henji-ui-surface`。\n');

process.exit(strict ? 1 : 0);
