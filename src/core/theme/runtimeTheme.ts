/**
 * 运行时主题应用：种子 + 覆盖 → 令牌（themeEngine）→ CSS 变量 + color-scheme（themeCssVars）→ 令牌订阅（themeTokenStore）。
 *
 * 玻璃组件层变量（`--ui-glass-*`、`--ui-scrim-*`）静态写在 index.css、引用语义变量，运行时不写它们
 * （内联样式会盖掉 `data-ui-blur='off'` 退化规则）。
 *
 * 外观设置的选择（预设 / 强调色 / 对比度）见 `themeSelection.ts`；主题文件格式与 v1 迁移见 `themeMigration.ts`。
 */
import { THEME_COMPONENT_CSS_VARS, buildThemeCssVariables } from './themeCssVars';
import { deriveThemeTokens, type ThemeSeed, type ThemeTokenOverrides, type ThemeTokens } from './themeEngine';
import { createThemeFirstFrame, writeThemeFirstFrame } from './themeFirstFrame';
import type { ThemeUiRadiusPreset } from './themeMigration';
import { publishThemeTokens } from './themeTokenStore';

export type UiRadiusPreset = ThemeUiRadiusPreset;

export interface RuntimeThemeConfig {
  seed: ThemeSeed;
  overrides?: ThemeTokenOverrides;
  uiRadiusPreset: UiRadiusPreset;
  /**
   * 界面毛玻璃。刻意不进主题 payload——它是观感/性能偏好，
   * 不属于可导出分享的配色方案。这里只负责把它同步到 documentElement。
   */
  uiBlurEnabled: boolean;
}

/**
 * 应用主题到根节点并发布令牌。
 * 只写语义变量；组件层变量若残留在内联样式里（1.2 以前的运行时写过）会遮住 index.css 的静态声明与
 * 毛玻璃关闭规则，因此逐个清掉。
 */
export function applyRuntimeTheme(config: RuntimeThemeConfig, root: HTMLElement = document.documentElement): ThemeTokens {
  const tokens = deriveThemeTokens(config.seed, config.overrides);
  const vars = buildThemeCssVariables(tokens);

  for (const item of THEME_COMPONENT_CSS_VARS) {
    root.style.removeProperty(item.name);
  }
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = tokens.colorScheme;
  delete root.dataset.themeTone;

  if (config.uiRadiusPreset === 'default') {
    delete root.dataset.uiRadius;
  } else {
    root.dataset.uiRadius = config.uiRadiusPreset;
  }
  if (config.uiBlurEnabled) {
    delete root.dataset.uiBlur;
  } else {
    root.dataset.uiBlur = 'off';
  }

  writeThemeFirstFrame(
    createThemeFirstFrame(tokens, vars, { uiRadiusPreset: config.uiRadiusPreset, uiBlurEnabled: config.uiBlurEnabled })
  );
  publishThemeTokens(tokens);
  return tokens;
}
