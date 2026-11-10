/**
 * 运行时主题应用：种子 + 覆盖 → 令牌（themeEngine）→ CSS 变量 + color-scheme（themeCssVars）→ 令牌订阅（themeTokenStore）。
 *
 * 玻璃组件层变量（`--ui-glass-*`、`--ui-scrim-*`）静态写在 index.css、引用语义变量，运行时不写它们
 * （内联样式会盖掉 `data-ui-blur='off'` 退化规则）。毛玻璃目前不开放：根节点固定 `data-ui-blur='off'`，
 * 所有浮层按实底加描边呈现；玻璃样式与组件参数保留，供以后只在画布上恢复。
 *
 * 外观设置的选择（预设 / 强调色 / 对比度）见 `themeSelection.ts`；主题文件格式见 `themeMigration.ts`。
 */
import { THEME_COMPONENT_CSS_VARS, buildThemeCssVariables } from './themeCssVars';
import { deriveThemeTokens, type ThemeSeed, type ThemeTokenOverrides, type ThemeTokens } from './themeEngine';
import { createThemeFirstFrame, writeThemeFirstFrame } from './themeFirstFrame';
import { publishThemeTokens } from './themeTokenStore';
import { UI_RADIUS_CSS_VAR, uiRadiusCssValue } from './uiRadius';

export interface RuntimeThemeConfig {
  seed: ThemeSeed;
  overrides?: ThemeTokenOverrides;
  /** 控件圆角像素值（见 `uiRadius.ts`） */
  uiRadius: number;
}

/**
 * 应用主题到根节点并发布令牌。
 * 只写语义变量；组件层变量若残留在内联样式里，会遮住 index.css 的静态声明与毛玻璃关闭规则，因此逐个清掉。圆角变量随颜色变量一起写，首帧缓存因此也带上它。
 */
export function applyRuntimeTheme(config: RuntimeThemeConfig, root: HTMLElement = document.documentElement): ThemeTokens {
  const tokens = deriveThemeTokens(config.seed, config.overrides);
  const vars = { ...buildThemeCssVariables(tokens), [UI_RADIUS_CSS_VAR]: uiRadiusCssValue(config.uiRadius) };

  for (const item of THEME_COMPONENT_CSS_VARS) {
    root.style.removeProperty(item.name);
  }
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = tokens.colorScheme;
  delete root.dataset.themeTone;
  delete root.dataset.uiRadius;
  root.dataset.uiBlur = 'off';

  writeThemeFirstFrame(createThemeFirstFrame(tokens, vars));
  publishThemeTokens(tokens);
  return tokens;
}
