/**
 * check:surface 规则 E：按钮、选项、标签、导航与字段触发器的调用点不得用 className 覆盖外观
 * （重要记录 003，任务 2.1 建立、2.2 扩展）。
 *
 * 外观只由组件的有限枚举决定——`UiButton variant/size`、`UiIconButton tone/size/on/shape`、
 * `UiOptionButton variant/size/active/selection`、`UiChipButton active/selectionRole/size`、`UiNavButton active/size`、
 * `UiFieldTrigger size/appearance`、`UiTextToken appearance/current/selected/excluded/flagged`（3.4）、`Dropdown`/`PanelTrigger` 的 `size`；className（下拉与面板触发器是 `buttonClassName`）
 * 只放布局（宽度、弹性、对齐、定位、外边距、内边距、显隐、过渡、指针）。以下类一律视为外观覆盖：
 *   - 底色、边框、文字色、圆角、阴影/环/描边、毛玻璃与滤镜、下划线（链接档负责）；
 *   - 字号与高度（`size` 负责）；图标按钮的宽高（`size` 负责）。
 *   - 选项/标签/导航允许 `h-full`、`h-auto` 与 `min-h-*`/`max-h-*`（内容卡片随网格拉伸或随内容撑高），固定高度仍走 `size`。
 *
 * 用 TypeScript AST 找到受检元素，把受检属性里的字符串、模板、条件分支，
 * 以及同文件 `const` 与 `components/ui/styleTokens.ts` 导出的类串常量都展开后逐个检查。
 *
 * 豁免：元素起始行或上一行注释含 `ui-surface-allow`，并写明理由与接手任务。
 */
const fs = require('fs');
const path = require('path');

let ts;
function loadTypeScript() {
  if (!ts) ts = require('typescript');
  return ts;
}

/** 受检组件 → 受检属性。 */
const CHECKED_ATTRIBUTES = {
  UiButton: 'className',
  UiIconButton: 'className',
  UiOptionButton: 'className',
  UiChipButton: 'className',
  UiNavButton: 'className',
  UiFieldTrigger: 'className',
  UiWindowControl: 'className',
  UiTextToken: 'className',
  Dropdown: 'buttonClassName',
  PanelTrigger: 'buttonClassName',
};
const CHECKED_COMPONENTS = new Set(Object.keys(CHECKED_ATTRIBUTES));
/** 内容随网格拉伸或随内容撑高的条目类组件：只禁止固定高度。 */
const ITEM_COMPONENTS = new Set(['UiOptionButton', 'UiChipButton', 'UiNavButton']);
const ITEM_FLEXIBLE_HEIGHT = /^(?:h-full|h-auto|min-h-.+|max-h-.+)$/;

const LINE_ALLOW_MARKER = 'ui-surface-allow';

const TEXT_NON_COLOR = new Set([
  'text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end',
  'text-ellipsis', 'text-clip', 'text-wrap', 'text-nowrap', 'text-balance', 'text-pretty',
]);
const FONT_SIZE_PATTERN = /^text-(?:\d*xs|sm|base|lg|\d*xl|\d+|\[[^\]]+\])$/;
const BG_LAYOUT = new Set(['bg-clip-content', 'bg-clip-padding', 'bg-clip-border', 'bg-no-repeat', 'bg-cover', 'bg-contain', 'bg-center']);

/**
 * @param {string} token 去掉变体前缀与 `!` 后的裸类
 * @param {string} component 受检组件名（见 CHECKED_ATTRIBUTES）
 * @returns {string | null} 违规类别，null 表示允许
 */
function classifyToken(token, component) {
  if (/^bg-/.test(token) && !BG_LAYOUT.has(token)) return '底色';
  if (/^bg-gradient/.test(token) || /^(from|via|to)-/.test(token)) return '底色';
  if (/^border(?:$|-)/.test(token)) return '边框';
  if (/^text-/.test(token)) {
    if (TEXT_NON_COLOR.has(token)) return null;
    if (FONT_SIZE_PATTERN.test(token)) return '字号（用 size）';
    return '文字色';
  }
  if (/^rounded(?:$|-)/.test(token)) return '圆角';
  if (/^(shadow|ring|outline)(?:$|-)/.test(token)) return '阴影/描边';
  if (/^(ui-glass|backdrop-|brightness-|saturate-|contrast-)/.test(token)) return '材质';
  if (token === 'underline' || /^(underline-offset|decoration)-/.test(token)) return '下划线（用 variant="link"）';
  if (/^(h|min-h|max-h)-/.test(token)) {
    if (ITEM_COMPONENTS.has(component) && ITEM_FLEXIBLE_HEIGHT.test(token)) return null;
    return '高度（用 size）';
  }
  if (component === 'UiIconButton' && /^(w|min-w|max-w|size)-/.test(token)) return '宽度（用 size）';
  return null;
}

/** @param {string} value */
function tokenize(value) {
  return value
    .split(/\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      // 去掉 hover: / group-hover: / [&>svg]: 这类变体前缀，以及 important 标记
      const withoutVariants = piece.includes(':') ? piece.slice(piece.lastIndexOf(':') + 1) : piece;
      return withoutVariants.replace(/^!+/, '').replace(/^-/, '');
    })
    .filter(Boolean);
}

/**
 * 收集文件里可以静态求值的类串常量：`const X = '...'` / 模板串（插值部分递归展开）。
 * @param {import('typescript').SourceFile} sf
 * @returns {Map<string, import('typescript').Expression>}
 */
function collectConstants(sf) {
  const t = loadTypeScript();
  const map = new Map();
  const visit = (node) => {
    if (t.isVariableDeclaration(node) && t.isIdentifier(node.name) && node.initializer) {
      map.set(node.name.text, node.initializer);
    }
    t.forEachChild(node, visit);
  };
  visit(sf);
  return map;
}

/**
 * 把表达式里的字符串片段展开成字符串数组（条件两支都收）。
 * @param {import('typescript').Node} expr
 * @param {Map<string, import('typescript').Expression>[]} scopes 依次查找的常量表
 * @param {Set<string>} seen
 * @returns {string[]}
 */
function collectStrings(expr, scopes, seen = new Set()) {
  const t = loadTypeScript();
  if (!expr) return [];
  if (t.isStringLiteral(expr) || t.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (t.isTemplateExpression(expr)) {
    const out = [expr.head.text];
    for (const span of expr.templateSpans) {
      out.push(...collectStrings(span.expression, scopes, seen), span.literal.text);
    }
    return out;
  }
  if (t.isJsxExpression(expr) || t.isParenthesizedExpression(expr) || t.isAsExpression(expr)) {
    return collectStrings(expr.expression, scopes, seen);
  }
  if (t.isConditionalExpression(expr)) {
    return [...collectStrings(expr.whenTrue, scopes, seen), ...collectStrings(expr.whenFalse, scopes, seen)];
  }
  if (t.isBinaryExpression(expr)) {
    return [...collectStrings(expr.left, scopes, seen), ...collectStrings(expr.right, scopes, seen)];
  }
  if (t.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((element) => collectStrings(element, scopes, seen));
  }
  if (t.isCallExpression(expr)) {
    // [a, b].join(' ') / cn(a, b)：展开参数与被调用的数组
    const parts = expr.arguments.flatMap((arg) => collectStrings(arg, scopes, seen));
    if (t.isPropertyAccessExpression(expr.expression)) parts.push(...collectStrings(expr.expression.expression, scopes, seen));
    return parts;
  }
  if (t.isIdentifier(expr)) {
    if (seen.has(expr.text)) return [];
    for (const scope of scopes) {
      const init = scope.get(expr.text);
      if (init) {
        seen.add(expr.text);
        return collectStrings(init, scopes, seen);
      }
    }
  }
  return [];
}

/**
 * @param {string} styleTokensPath
 * @returns {Map<string, import('typescript').Expression>}
 */
function loadSharedConstants(styleTokensPath) {
  const t = loadTypeScript();
  if (!fs.existsSync(styleTokensPath)) return new Map();
  const raw = fs.readFileSync(styleTokensPath, 'utf8');
  const sf = t.createSourceFile(styleTokensPath, raw, t.ScriptTarget.Latest, true, t.ScriptKind.TS);
  return collectConstants(sf);
}

/** 按文件缓存的常量表（跨文件解析 import 进来的类串常量用）。 */
const constantsCache = new Map();

/**
 * @param {string} file
 * @returns {Map<string, import('typescript').Expression>}
 */
function constantsOfFile(file) {
  if (constantsCache.has(file)) return constantsCache.get(file);
  const t = loadTypeScript();
  let map = new Map();
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    const sf = t.createSourceFile(file, raw, t.ScriptTarget.Latest, true, file.endsWith('x') ? t.ScriptKind.TSX : t.ScriptKind.TS);
    map = collectConstants(sf);
  }
  constantsCache.set(file, map);
  return map;
}

/**
 * 解析 `import { X } from '@/…' | './…'` 中引入的类串常量（只看命名导入，不追 re-export）。
 * @param {import('typescript').SourceFile} sf
 * @param {string} fileName
 * @param {string | undefined} srcRoot
 * @returns {Map<string, import('typescript').Expression>}
 */
function collectImportedConstants(sf, fileName, srcRoot) {
  const t = loadTypeScript();
  const map = new Map();
  for (const statement of sf.statements) {
    if (!t.isImportDeclaration(statement) || !statement.importClause || !t.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause.namedBindings;
    if (!bindings || !t.isNamedImports(bindings)) continue;
    const spec = statement.moduleSpecifier.text;
    let base;
    if (spec.startsWith('@/') && srcRoot) base = path.join(srcRoot, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fileName), spec);
    else continue;
    const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    const target = candidates.find((candidate) => fs.existsSync(candidate));
    if (!target) continue;
    const constants = constantsOfFile(target);
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text;
      const init = constants.get(exported);
      if (init) map.set(element.name.text, init);
    }
  }
  return map;
}

/**
 * @param {string} raw 源码
 * @param {string} fileName
 * @param {Map<string, import('typescript').Expression>} shared
 * @param {string} [srcRoot]
 * @returns {{ line: number, component: string, violations: { token: string, kind: string }[] }[]}
 */
function findButtonAppearanceOverridesInSource(raw, fileName, shared = new Map(), srcRoot) {
  const t = loadTypeScript();
  if (![...CHECKED_COMPONENTS].some((name) => raw.includes(name))) return [];
  const sf = t.createSourceFile(fileName, raw, t.ScriptTarget.Latest, true, t.ScriptKind.TSX);
  const local = collectConstants(sf);
  const imported = collectImportedConstants(sf, fileName, srcRoot);
  const lines = raw.split(/\r?\n/);
  const findings = [];

  const visit = (node) => {
    if ((t.isJsxOpeningElement(node) || t.isJsxSelfClosingElement(node))) {
      const component = node.tagName.getText(sf);
      if (CHECKED_COMPONENTS.has(component)) {
        const attrName = CHECKED_ATTRIBUTES[component];
        const classAttr = node.attributes.properties.find(
          (attr) => t.isJsxAttribute(attr) && attr.name.getText(sf) === attrName,
        );
        if (classAttr && classAttr.initializer) {
          const strings = collectStrings(classAttr.initializer, [local, imported, shared]);
          const violations = [];
          const seenTokens = new Set();
          for (const token of strings.flatMap(tokenize)) {
            if (seenTokens.has(token)) continue;
            seenTokens.add(token);
            const kind = classifyToken(token, component);
            if (kind) violations.push({ token, kind });
          }
          if (violations.length) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            const allowed = (lines[line - 1] ?? '').includes(LINE_ALLOW_MARKER)
              || (lines[line - 2] ?? '').includes(LINE_ALLOW_MARKER);
            if (!allowed) findings.push({ line, component, violations });
          }
        }
      }
    }
    t.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/**
 * @param {{ srcRoot: string, projectRoot: string, files: string[] }} options
 */
function findButtonAppearanceOverrides({ srcRoot, projectRoot, files }) {
  const shared = loadSharedConstants(path.join(srcRoot, 'components', 'ui', 'styleTokens.ts'));
  const definition = path.normalize(path.join(srcRoot, 'components', 'ui', 'primitives.tsx'));
  const results = [];
  for (const file of files) {
    if (path.normalize(file) === definition) continue;
    if (/\.test\.tsx$/.test(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    for (const finding of findButtonAppearanceOverridesInSource(raw, file, shared, srcRoot)) {
      results.push({ relativePath: path.relative(projectRoot, file).replace(/\\/g, '/'), ...finding });
    }
  }
  return results;
}

module.exports = {
  CHECKED_ATTRIBUTES,
  CHECKED_COMPONENTS,
  classifyToken,
  findButtonAppearanceOverrides,
  findButtonAppearanceOverridesInSource,
};
