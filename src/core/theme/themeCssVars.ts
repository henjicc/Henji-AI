/**
 * 令牌 → CSS 变量映射（纯函数，第二段接线时由 runtimeTheme 与 index.css 使用）。
 *
 * 命名：
 * - 新语义变量 `--{kebab}`，值为完整颜色（`#RRGGBB` 或 `rgba()`），如 `--text1`、`--control-hover`；
 * - 不透明令牌另出 `--{kebab}-rgb` 三元组（`r g b`），兼容 `rgb(var(--x-rgb) / a)` 与 Tailwind 透明度修饰。
 *
 * 旧变量（1.1 第七节）全部改为**静态别名**写在 index.css（`--app-rgb: var(--window-rgb)`），
 * 运行时只写新变量。原因：
 * 1. 运行时写在 documentElement 的内联样式优先级最高，会盖掉 `:root[data-ui-blur='off']`
 *    对 `--ui-glass-*`/`--ui-scrim-*` 的退化规则；别名放在 CSS 里则两者各自生效。
 * 2. 旧别名删除（4.2）只需删 CSS，不动引擎。
 *
 * 冲突：`--danger-rgb`/`--success-rgb`/`--warning-rgb` 旧义以文字用法为主（text-danger 19 处等），
 * 过渡期别名指向 `*Text`；同名的新实底三元组因此不由运行时输出（实底的透明变体已有 `*Tint` 令牌）。
 * 4.2 删除旧别名后，这三个名字自动回到实底三元组。
 */
import { THEME_COLOR_TOKEN_NAMES, type ThemeColorTokenName, type ThemeTokens } from './themeEngine';
import { parseColor, toRgbTriple } from './themeColor';

export function themeTokenCssVar(name: ThemeColorTokenName): string {
  return `--${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

export function themeTokenRgbVar(name: ThemeColorTokenName): string {
  return `${themeTokenCssVar(name)}-rgb`;
}

export const THEME_TOKEN_CSS_VARS = Object.fromEntries(
  THEME_COLOR_TOKEN_NAMES.map((name) => [name, themeTokenCssVar(name)])
) as Record<ThemeColorTokenName, string>;

export interface LegacyThemeCssAlias {
  /** 旧变量名 */
  legacy: string;
  /** 指向的新令牌 */
  token: ThemeColorTokenName;
  /** rgb：三元组，指向 `--{token}-rgb`；color：完整颜色，指向 `--{token}` */
  format: 'rgb' | 'color';
  /** 旧用途 / 选择理由 */
  note: string;
}

/**
 * 1.1 第七节映射表的运行时版本（只含能一对一别名的变量；按用途拆分的由 1.3/2.x 迁移调用点）。
 * `--panel-rgb`、`--canvas-rgb`、`--accent-rgb` 与新三元组同名同义，直接由运行时输出，不另设别名。
 */
export const LEGACY_THEME_CSS_ALIASES: readonly LegacyThemeCssAlias[] = [
  { legacy: '--app-rgb', token: 'window', format: 'rgb', note: 'bg-app：窗口、工作区底' },
  { legacy: '--bg-rgb', token: 'gap', format: 'rgb', note: 'bg-bg-dark：波形区/复选框/视口；媒体视口由调用点改 media' },
  { legacy: '--surface-rgb', token: 'raised', format: 'rgb', note: 'bg-surface-dark：字段与按钮底；按钮由 2.1 改 control' },
  { legacy: '--layer-rgb', token: 'hover', format: 'rgb', note: 'bg-layer：悬停底；选中由调用点改 selected' },
  { legacy: '--border-rgb', token: 'line', format: 'rgb', note: 'border-border-dark：发丝线' },
  { legacy: '--text-rgb', token: 'text1', format: 'rgb', note: 'text-text-dark：主要文字' },
  { legacy: '--text-soft-rgb', token: 'text2', format: 'rgb', note: 'text-text-soft：次要正文' },
  { legacy: '--text-muted-rgb', token: 'text2', format: 'rgb', note: 'text-text-muted：说明/图标；元信息由调用点改 text3' },
  { legacy: '--text-faint-rgb', token: 'text3', format: 'rgb', note: 'text-text-faint：占位、弱提示' },
  { legacy: '--brand-300-rgb', token: 'accentText', format: 'rgb', note: 'text-brand-300：强调文字' },
  { legacy: '--brand-500-rgb', token: 'accent', format: 'rgb', note: 'bg-brand-500：主按钮底（白字）' },
  { legacy: '--brand-600-rgb', token: 'accentPressed', format: 'rgb', note: '单选/开关/下拉当前项实底（白字），2.2 改 selected/accent' },
  { legacy: '--brand-700-rgb', token: 'accentPressed', format: 'rgb', note: '提示词优化渐变暗端' },
  { legacy: '--danger-rgb', token: 'dangerText', format: 'rgb', note: '旧义以文字为主（text-danger 19、bg-danger 5）' },
  { legacy: '--success-rgb', token: 'successText', format: 'rgb', note: '旧义以文字为主（text-success 3）' },
  { legacy: '--warning-rgb', token: 'warningText', format: 'rgb', note: '旧义以文字为主（text-warning 9、bg-warning 3）' },
  { legacy: '--ui-surface-panel', token: 'panel', format: 'color', note: 'storyboard.css 等纯 CSS 面板' },
  { legacy: '--ui-surface-field', token: 'raised', format: 'color', note: '纯 CSS 字段底' },
  { legacy: '--ui-border-soft', token: 'line', format: 'color', note: '纯 CSS 弱边' },
  { legacy: '--ui-border-strong', token: 'lineStrong', format: 'color', note: '纯 CSS 强边' },
  { legacy: '--ui-glass-tint', token: 'glassTint', format: 'color', note: '玻璃底（毛玻璃关闭时由 data-ui-blur 规则改实底）' },
  { legacy: '--ui-glass-edge', token: 'glassEdge', format: 'color', note: '玻璃受光边' },
  { legacy: '--ui-glass-sheen', token: 'glassSheen', format: 'color', note: '玻璃顶部高光' },
  { legacy: '--ui-glass-hover', token: 'glassHover', format: 'color', note: '玻璃上的悬停' },
  { legacy: '--ui-glass-press', token: 'glassPressed', format: 'color', note: '玻璃上的按下' },
  { legacy: '--ui-glass-selected', token: 'glassSelected', format: 'color', note: '玻璃上的选中' },
  { legacy: '--ui-glass-divider', token: 'glassDivider', format: 'color', note: '玻璃内分隔' },
  { legacy: '--ui-glass-control-tint', token: 'glassControlTint', format: 'color', note: '玻璃内控件纱' },
  { legacy: '--ui-glass-region-tint', token: 'glassRegionTint', format: 'color', note: '玻璃内连续区域' },
  { legacy: '--ui-glass-surface-tint', token: 'glassSurfaceTint', format: 'color', note: '玻璃内内容表面' },
  { legacy: '--ui-scrim-tint', token: 'scrim', format: 'color', note: '弹窗遮罩' },
  { legacy: '--ui-scrim-tint-soft', token: 'scrimSoft', format: 'color', note: '玻璃弹窗的浅遮罩' },
];

const LEGACY_ALIAS_NAMES = new Set(LEGACY_THEME_CSS_ALIASES.map((alias) => alias.legacy));

function isOpaque(color: string): boolean {
  return parseColor(color)?.a === 1;
}

/**
 * 运行时写入 documentElement 的变量（只含新变量；与旧别名同名的三元组跳过，见文件头）。
 * `color-scheme` 不是变量，由调用方写 `root.style.colorScheme = tokens.colorScheme`。
 */
export function buildThemeCssVariables(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of THEME_COLOR_TOKEN_NAMES) {
    const value = tokens.colors[name];
    vars[themeTokenCssVar(name)] = value;
    const rgbVar = themeTokenRgbVar(name);
    if (isOpaque(value) && !LEGACY_ALIAS_NAMES.has(rgbVar)) {
      vars[rgbVar] = toRgbTriple(value);
    }
  }
  return vars;
}

/** index.css 中的旧别名声明（静态，引用新变量）。 */
export function buildLegacyAliasDeclarations(): Record<string, string> {
  return Object.fromEntries(
    LEGACY_THEME_CSS_ALIASES.map((alias) => [
      alias.legacy,
      alias.format === 'rgb' ? `var(${themeTokenRgbVar(alias.token)})` : `var(${themeTokenCssVar(alias.token)})`,
    ])
  );
}

/** 把声明格式化为 CSS 文本（供第二段生成 index.css 默认值、首帧内联样式）。 */
export function formatCssDeclarations(declarations: Record<string, string>, indent = '  '): string {
  return Object.entries(declarations)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}
