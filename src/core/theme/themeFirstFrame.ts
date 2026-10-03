/**
 * 首帧主题缓存。
 *
 * 主题在 React effect 里应用，此前页面先按 index.css 的静态默认值（石墨）绘制。非默认主题（如纸白）启动时会闪一下深色。
 * `applyRuntimeTheme` 每次应用后把 CSS 变量与 color-scheme 写进 localStorage；`index.html` 的内联脚本在样式表加载前
 * 读取并写到根节点（该脚本不能 import 模块，因此键名与结构在这里定义、由 `themeStaticDefaults.test.ts` 执行真实脚本校验）。
 *
 * 只缓存可直接写回根节点的结果，不缓存种子：内联脚本不做任何推导。
 */
import type { ThemeMode, ThemeTokens } from './themeEngine';

export const THEME_FIRST_FRAME_STORAGE_KEY = 'henji-theme-first-frame';

export interface ThemeFirstFrame {
  version: 1;
  colorScheme: ThemeMode;
  /** 运行时写入根节点的 CSS 变量（与 buildThemeCssVariables 输出相同） */
  vars: Record<string, string>;
  /** `data-ui-radius`；默认档不写 */
  uiRadius?: 'compact' | 'large';
  /** `data-ui-blur`；仅关闭时写 'off' */
  uiBlur?: 'off';
}

export function createThemeFirstFrame(
  tokens: ThemeTokens,
  vars: Record<string, string>,
  options: { uiRadiusPreset: 'compact' | 'default' | 'large'; uiBlurEnabled: boolean }
): ThemeFirstFrame {
  const frame: ThemeFirstFrame = { version: 1, colorScheme: tokens.colorScheme, vars };
  if (options.uiRadiusPreset !== 'default') {
    frame.uiRadius = options.uiRadiusPreset;
  }
  if (!options.uiBlurEnabled) {
    frame.uiBlur = 'off';
  }
  return frame;
}

/** 写缓存；存储不可用（隐私模式、配额）时静默放弃——缺缓存只会回到静态默认首帧，不影响正确性。 */
export function writeThemeFirstFrame(frame: ThemeFirstFrame, storage: Pick<Storage, 'setItem'> | null = getLocalStorage()): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(THEME_FIRST_FRAME_STORAGE_KEY, JSON.stringify(frame));
  } catch {
    // 见函数说明
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
