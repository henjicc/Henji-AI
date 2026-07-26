import { useEffect } from 'react';
import { applyRuntimeTheme } from '@/core/theme/runtimeTheme';
import { useSettingsStore } from '@/stores/settingsStore';

export function useApplyRuntimeTheme(): void {
  const themeTonePreset = useSettingsStore((state) => state.themeTonePreset);
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const colors = useSettingsStore((state) => state.themeColors);
  const uiBlurEnabled = useSettingsStore((state) => state.uiBlurEnabled);

  useEffect(() => {
    applyRuntimeTheme({
      themeTonePreset,
      uiRadiusPreset,
      accentColor,
      colors,
      uiBlurEnabled,
    });
  }, [themeTonePreset, uiRadiusPreset, accentColor, colors, uiBlurEnabled]);
}

