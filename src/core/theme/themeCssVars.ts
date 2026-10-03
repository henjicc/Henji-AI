/**
 * 令牌 → CSS 变量映射（纯函数，由 runtimeTheme 与 index.css 静态默认值使用）。
 *
 * 命名：
 * - 新语义变量 `--{kebab}`，值为完整颜色（`#RRGGBB` 或 `rgba()`），如 `--text1`、`--control-hover`；
 * - 不透明令牌另出 `--{kebab}-rgb` 三元组（`r g b`），兼容 `rgb(var(--x-rgb) / a)` 与 Tailwind 透明度修饰。
 *
 * 组件层变量（`--ui-glass-*`、`--ui-scrim-*`）是玻璃材质的组件令牌，**静态**写在 index.css、引用语义变量，
 * 运行时不写它们：写在 documentElement 的内联样式优先级最高，会盖掉 `:root[data-ui-blur='off']` 把玻璃退化成
 * 实底的规则；放在 CSS 里两者各自生效。
 *
 * 1.1 第七节的旧变量别名（`--app-rgb`、`--text-muted-rgb`、`--ui-surface-panel` 等）已在界面重设计 4.2 删除，
 * 调用点改用新语义变量，`check:colors` 拦截旧名再次出现。`--danger-rgb`/`--success-rgb`/`--warning-rgb` 从此
 * 与 `--danger` 等同义（实底三元组），文字色用 `--danger-text-rgb` 等。
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

export interface ThemeComponentCssVar {
  /** 组件层变量名 */
  name: string;
  /** 指向的语义令牌（完整颜色，指向 `--{token}`） */
  token: ThemeColorTokenName;
  /** 用途 */
  note: string;
}

/**
 * 玻璃材质的组件层变量（静态写在 index.css 的 `theme-component-vars` 块，见文件头）。
 * 毛玻璃关闭时由 `:root[data-ui-blur='off']` 改指实底令牌。
 */
export const THEME_COMPONENT_CSS_VARS: readonly ThemeComponentCssVar[] = [
  { name: '--ui-glass-tint', token: 'glassTint', note: '玻璃底（毛玻璃关闭时由 data-ui-blur 规则改实底）' },
  { name: '--ui-glass-edge', token: 'glassEdge', note: '玻璃受光边' },
  { name: '--ui-glass-sheen', token: 'glassSheen', note: '玻璃顶部高光' },
  { name: '--ui-glass-hover', token: 'glassHover', note: '玻璃上的悬停' },
  { name: '--ui-glass-press', token: 'glassPressed', note: '玻璃上的按下' },
  { name: '--ui-glass-selected', token: 'glassSelected', note: '玻璃上的选中' },
  { name: '--ui-glass-divider', token: 'glassDivider', note: '玻璃内分隔' },
  { name: '--ui-glass-control-tint', token: 'glassControlTint', note: '玻璃内控件纱' },
  { name: '--ui-glass-region-tint', token: 'glassRegionTint', note: '玻璃内连续区域' },
  { name: '--ui-glass-surface-tint', token: 'glassSurfaceTint', note: '玻璃内内容表面' },
  { name: '--ui-scrim-tint', token: 'scrim', note: '弹窗遮罩' },
  { name: '--ui-scrim-tint-soft', token: 'scrimSoft', note: '玻璃弹窗的浅遮罩' },
];

function isOpaque(color: string): boolean {
  return parseColor(color)?.a === 1;
}

/**
 * 运行时写入 documentElement 的变量（只含语义变量，不含组件层变量，见文件头）。
 * `color-scheme` 不是变量，由调用方写 `root.style.colorScheme = tokens.colorScheme`。
 */
export function buildThemeCssVariables(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of THEME_COLOR_TOKEN_NAMES) {
    const value = tokens.colors[name];
    vars[themeTokenCssVar(name)] = value;
    if (isOpaque(value)) {
      vars[themeTokenRgbVar(name)] = toRgbTriple(value);
    }
  }
  return vars;
}

/** index.css 中的组件层变量声明（静态，引用语义变量）。 */
export function buildComponentVarDeclarations(): Record<string, string> {
  return Object.fromEntries(
    THEME_COMPONENT_CSS_VARS.map((item) => [item.name, `var(${themeTokenCssVar(item.token)})`])
  );
}

/** 把声明格式化为 CSS 文本（供第二段生成 index.css 默认值、首帧内联样式）。 */
export function formatCssDeclarations(declarations: Record<string, string>, indent = '  '): string {
  return Object.entries(declarations)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}
