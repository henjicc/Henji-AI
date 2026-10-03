import { useSyncExternalStore } from 'react';
import type { ThemeTokens } from '@/core/theme/themeEngine';
import { getThemeTokens, subscribeThemeTokens } from '@/core/theme/themeTokenStore';

/**
 * 当前主题令牌（供 SVG/Canvas/WebGL 等拿不到 CSS 变量的渲染面）。
 * 快照只在令牌真正变化时更换引用，切换主题时订阅组件重渲染。
 */
export function useThemeTokens(): ThemeTokens {
  return useSyncExternalStore(subscribeThemeTokens, getThemeTokens, getThemeTokens);
}
