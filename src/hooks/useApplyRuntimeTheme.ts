import { useEffect } from 'react';
import { readDevelopmentLaunchOptions } from '@/core/development/developmentLaunch';
import { createLogger } from '@/core/logging';
import { applyRuntimeTheme } from '@/core/theme/runtimeTheme';
import { THEME_PRESETS, THEME_PRESET_IDS, type ThemePresetId, type ThemeSeed, type ThemeTokenOverrides, type ThemeTokens } from '@/core/theme/themeEngine';
import { getPlatform, isDesktopRuntime } from '@/platform/runtime';
import { useSettingsStore } from '@/stores/settingsStore';

const logger = createLogger('hooks.useApplyRuntimeTheme');

/** 本渲染进程上次成功同步给主进程的窗口外观；相同则不重复发送（主进程侧也会去重）。 */
let lastSyncedAppearanceKey: string | null = null;

/** 把主题的 window 底色与 color-scheme 同步给主进程（新窗口首帧、缩放露底）。导出供测试。 */
export async function syncWindowAppearance(tokens: ThemeTokens): Promise<void> {
  if (!isDesktopRuntime()) return;
  const appearance = { windowBackground: tokens.colors.window, colorScheme: tokens.colorScheme };
  const key = `${appearance.windowBackground}|${appearance.colorScheme}`;
  if (key === lastSyncedAppearanceKey) return;
  try {
    await getPlatform().window.setAppearance(appearance);
    lastSyncedAppearanceKey = key;
  } catch (error) {
    logger.error('窗口底色同步到主进程失败，新窗口首帧可能仍为默认底色', {
      event: 'theme.window_appearance.sync.failed',
      context: appearance,
      error,
    });
  }
}

/**
 * 开发启动参数 `--dev-theme-preset=<id>`：本次启动临时改用该预设（种子与覆盖都换成预设），不写入用户设置。
 * 只用于真实界面巡检按预设截图；参数无效或未提供时返回 null。导出供测试。
 */
export function resolveDevelopmentThemeOverride(
  search?: string
): { seed: ThemeSeed; overrides: ThemeTokenOverrides } | null {
  const presetId = readDevelopmentLaunchOptions(search).themePresetId;
  if (!presetId || !(THEME_PRESET_IDS as readonly string[]).includes(presetId)) return null;
  return { seed: THEME_PRESETS[presetId as ThemePresetId].seed, overrides: {} };
}

const developmentThemeOverride = resolveDevelopmentThemeOverride();

export function resetWindowAppearanceSyncForTests(): void {
  lastSyncedAppearanceKey = null;
}

export function useApplyRuntimeTheme(): void {
  const seed = useSettingsStore((state) => state.themeSeed);
  const overrides = useSettingsStore((state) => state.themeOverrides);
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset);
  const uiBlurEnabled = useSettingsStore((state) => state.uiBlurEnabled);

  useEffect(() => {
    const theme = developmentThemeOverride ?? { seed, overrides };
    const tokens = applyRuntimeTheme({ seed: theme.seed, overrides: theme.overrides, uiRadiusPreset, uiBlurEnabled });
    void syncWindowAppearance(tokens);
  }, [seed, overrides, uiRadiusPreset, uiBlurEnabled]);
}
