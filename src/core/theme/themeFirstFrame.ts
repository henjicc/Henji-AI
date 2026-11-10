/**
 * 首帧主题缓存。
 *
 * 主题在 React effect 里应用，此前页面先按 index.css 的静态默认值（石墨）绘制。非默认主题（如纸白）启动时会闪一下深色。
 * `applyRuntimeTheme` 每次应用后把 CSS 变量（含圆角 `--radius-base`）与 color-scheme 写进 localStorage；`index.html` 的内联脚本
 * 在样式表加载前读取并写到根节点（该脚本不能 import 模块，因此键名与结构在这里定义、由 `themeStaticDefaults.test.ts` 执行真实脚本校验）。
 *
 * 只缓存可直接写回根节点的结果，不缓存种子：内联脚本不做任何推导。毛玻璃固定关闭，由 index.html 的静态属性承担。
 */
import type { ThemeMode, ThemeTokens } from './themeEngine';

export const THEME_FIRST_FRAME_STORAGE_KEY = 'henji-theme-first-frame';

export interface ThemeFirstFrame {
  version: 1;
  colorScheme: ThemeMode;
  /** 运行时写入根节点的 CSS 变量 */
  vars: Record<string, string>;
}

export function createThemeFirstFrame(tokens: ThemeTokens, vars: Record<string, string>): ThemeFirstFrame {
  return { version: 1, colorScheme: tokens.colorScheme, vars };
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
