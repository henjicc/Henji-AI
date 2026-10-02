/**
 * 当前主题令牌的读取与订阅（供画布点阵、edgeFlowCanvas、波形、3D 镜头时间线、标注变换框、
 * 拖拽预览等非 DOM / 非 CSS 渲染面使用）。
 *
 * - `getThemeTokens()` 返回不可变快照，引用只在令牌真正变化时更换，可直接作为
 *   React `useSyncExternalStore` 的 getSnapshot；
 * - `publishThemeTokens()` 由主题应用入口（第二段的 runtimeTheme）在写 CSS 变量后调用；
 *   内容未变时不通知，避免订阅方重复重绘。
 *
 * 第一段只提供实现，尚未被应用代码引用。
 */
import { DEFAULT_THEME_SEED, THEME_COLOR_TOKEN_NAMES, deriveThemeTokens, type ThemeTokens } from './themeEngine';

export type ThemeTokensListener = (tokens: ThemeTokens) => void;

export interface ThemeTokenStore {
  getThemeTokens: () => ThemeTokens;
  subscribeThemeTokens: (listener: ThemeTokensListener) => () => void;
  /** 返回是否发生了变化 */
  publishThemeTokens: (tokens: ThemeTokens) => boolean;
}

function freezeTokens(tokens: ThemeTokens): ThemeTokens {
  return Object.freeze({ ...tokens, colors: Object.freeze({ ...tokens.colors }) });
}

export function areThemeTokensEqual(a: ThemeTokens, b: ThemeTokens): boolean {
  if (a === b) {
    return true;
  }
  if (a.mode !== b.mode || a.colorScheme !== b.colorScheme) {
    return false;
  }
  return THEME_COLOR_TOKEN_NAMES.every((name) => a.colors[name] === b.colors[name]);
}

export function createThemeTokenStore(initial: ThemeTokens = deriveThemeTokens(DEFAULT_THEME_SEED)): ThemeTokenStore {
  let current = freezeTokens(initial);
  const listeners = new Set<ThemeTokensListener>();

  return {
    getThemeTokens: () => current,
    subscribeThemeTokens: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publishThemeTokens: (tokens) => {
      if (areThemeTokensEqual(current, tokens)) {
        return false;
      }
      current = freezeTokens(tokens);
      // 复制一份再遍历：回调里取消订阅不影响本轮通知
      for (const listener of [...listeners]) {
        listener(current);
      }
      return true;
    },
  };
}

const defaultStore = createThemeTokenStore();

export const getThemeTokens = defaultStore.getThemeTokens;
export const subscribeThemeTokens = defaultStore.subscribeThemeTokens;
export const publishThemeTokens = defaultStore.publishThemeTokens;
