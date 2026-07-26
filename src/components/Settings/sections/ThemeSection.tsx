import React from 'react';
import Dropdown from '@/components/ui/Dropdown';
import {
  UI_FIELD_CONTROL_HEIGHT_CLASS,
  UiButton,
  UiColorInput,
  UiIconButton,
  UiInput,
  UiPanel,
  UiSwitch,
} from '@/components/ui';
import SectionCard from '../components/SectionCard';
import { useI18n } from '@/hooks/useI18n';
import {
  ACCENT_PRESET_OPTIONS,
  DEFAULT_THEME_COLOR_SCHEME,
  THEME_COLOR_TOKENS,
  THEME_PALETTE_PRESETS,
  getTokenColorOptions,
  type ThemeImportMode,
  type ThemeColorScheme,
  type ThemeColorToken,
  type ThemeTonePreset,
  type UiRadiusPreset,
} from '@/core/theme/runtimeTheme';
import SettingsDialog from '../components/SettingsDialog';

interface ThemeSectionProps {
  themeTonePreset: ThemeTonePreset;
  uiRadiusPreset: UiRadiusPreset;
  uiBlurEnabled: boolean;
  accentColor: string;
  colors: ThemeColorScheme;
  onChangeThemeTone: (preset: ThemeTonePreset) => void;
  onChangeUiRadius: (preset: UiRadiusPreset) => void;
  onChangeUiBlurEnabled: (enabled: boolean) => void;
  onChangeAccentColor: (color: string) => void;
  onChangeThemeColor: (token: ThemeColorToken, color: string) => void;
  onApplyPalette: (colors: Partial<ThemeColorScheme>) => void;
  onResetThemeColors: () => void;
  onExportTheme: () => void;
  onImportTheme: (file: File, mode: ThemeImportMode) => Promise<boolean>;
}

const tokenLabelKeyMap: Record<ThemeColorToken, string> = {
  bg: 'sections.theme.tokens.bg',
  surface: 'sections.theme.tokens.surface',
  border: 'sections.theme.tokens.border',
  text: 'sections.theme.tokens.text',
  textMuted: 'sections.theme.tokens.textMuted',
  app: 'sections.theme.tokens.app',
  canvas: 'sections.theme.tokens.canvas',
  panel: 'sections.theme.tokens.panel',
  layer: 'sections.theme.tokens.layer',
};

const ThemeSection: React.FC<ThemeSectionProps> = ({
  themeTonePreset,
  uiRadiusPreset,
  uiBlurEnabled,
  accentColor,
  colors,
  onChangeThemeTone,
  onChangeUiRadius,
  onChangeUiBlurEnabled,
  onChangeAccentColor,
  onChangeThemeColor,
  onApplyPalette,
  onResetThemeColors,
  onExportTheme,
  onImportTheme,
}) => {
  const { t, i18n } = useI18n('settings');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [pendingImportFile, setPendingImportFile] = React.useState<File | null>(null);
  const [modeDialogOpen, setModeDialogOpen] = React.useState(false);
  const [feedbackDialog, setFeedbackDialog] = React.useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  const handleModeImport = async (mode: ThemeImportMode): Promise<void> => {
    if (!pendingImportFile) {
      return;
    }
    setImporting(true);
    const ok = await onImportTheme(pendingImportFile, mode);
    setImporting(false);
    setModeDialogOpen(false);
    setPendingImportFile(null);
    setFeedbackDialog({
      open: true,
      message: ok ? t('sections.theme.portable.importSuccess') : t('sections.theme.portable.importFail'),
    });
  };

  const toneOptions: Array<{ value: ThemeTonePreset; label: string }> = [
    { value: 'neutral', label: t('sections.theme.tone.neutral') },
    { value: 'warm', label: t('sections.theme.tone.warm') },
    { value: 'cool', label: t('sections.theme.tone.cool') },
  ];

  const radiusOptions: Array<{ value: UiRadiusPreset; label: string }> = [
    { value: 'compact', label: t('sections.theme.radius.compact') },
    { value: 'default', label: t('sections.theme.radius.default') },
    { value: 'large', label: t('sections.theme.radius.large') },
  ];

  return (
    <SectionCard
      title={t('sections.theme.title')}
      description={t('sections.theme.description')}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Dropdown
            label={t('sections.theme.tone.label')}
            value={themeTonePreset}
            options={toneOptions}
            display={toneOptions.find((option) => option.value === themeTonePreset)?.label}
            onSelect={(value) => onChangeThemeTone(value as ThemeTonePreset)}
            className="w-full"
          />

          <Dropdown
            label={t('sections.theme.radius.label')}
            value={uiRadiusPreset}
            options={radiusOptions}
            display={radiusOptions.find((option) => option.value === uiRadiusPreset)?.label}
            onSelect={(value) => onChangeUiRadius(value as UiRadiusPreset)}
            className="w-full"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-soft">
              {t('sections.theme.blur.label')}
            </div>
            <div className="mt-1 text-xs text-text-faint">
              {t('sections.theme.blur.hint')}
            </div>
          </div>
          <UiSwitch checked={uiBlurEnabled} onCheckedChange={onChangeUiBlurEnabled} />
        </div>

        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {t('sections.theme.palette.label')}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {THEME_PALETTE_PRESETS.map((preset) => (
              <UiButton
                key={preset.id}
                variant="muted"
                size="sm"
                className="h-auto flex-col items-start gap-1.5 px-2 py-2"
                onClick={() => onApplyPalette(preset.colors)}
              >
                <div className="text-xs font-medium text-text-dark">
                  {i18n.language.startsWith('zh') ? preset.name.zh : preset.name.en}
                </div>
                <div className="flex items-center gap-1">
                  {(['bg', 'surface', 'border', 'text'] as ThemeColorToken[]).map((token) => (
                    <span
                      key={`${preset.id}-${token}`}
                      className="h-3 w-3 rounded-full border border-border-dark"
                      style={{ backgroundColor: preset.colors[token] }}
                    />
                  ))}
                </div>
              </UiButton>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
              {t('sections.theme.accent.label')}
            </div>
            <UiButton
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-2xs"
              onClick={onResetThemeColors}
            >
              {t('actions.resetDefault')}
            </UiButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESET_OPTIONS.map((option) => (
              <UiIconButton
                key={option}
                showBorder
                className="!h-7 !w-7 !rounded-md"
                aria-label={option}
                onClick={() => onChangeAccentColor(option)}
                style={{ backgroundColor: option }}
                active={accentColor.toUpperCase() === option}
              />
            ))}
            <UiColorInput
              value={accentColor}
              onChange={(event) => onChangeAccentColor(event.target.value)}
              className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} ml-1`}
            />
            <UiInput
              value={accentColor}
              onChange={(event) => onChangeAccentColor(event.target.value)}
              className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} w-28 font-mono text-xs uppercase`}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {t('sections.theme.portable.label')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UiButton
              variant="muted"
              size="field"
              className="px-3"
              onClick={onExportTheme}
            >
              {t('sections.theme.portable.export')}
            </UiButton>
            <UiButton
              variant="muted"
              size="field"
              className="px-3"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? t('actions.checking') : t('sections.theme.portable.import')}
            </UiButton>
            <UiInput
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (!file) {
                  return;
                }
                setPendingImportFile(file);
                setModeDialogOpen(true);
              }}
            />
          </div>
        </div>

        <UiPanel className="p-3">
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">
            {t('sections.theme.advanced.label')}
          </div>
          <div className="grid grid-cols-1 gap-3">
            {THEME_COLOR_TOKENS.map((token) => (
              <div key={token} className="rounded-lg border border-border-dark bg-surface-dark p-2">
                <div className="mb-2 text-xs text-text-soft">{t(tokenLabelKeyMap[token])}</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {getTokenColorOptions(token).map((option) => (
                    <UiIconButton
                      key={`${token}-${option}`}
                      showBorder
                      className="!h-6 !w-6 !rounded-md"
                      aria-label={option}
                      onClick={() => onChangeThemeColor(token, option)}
                      style={{ backgroundColor: option }}
                      active={colors[token].toUpperCase() === option}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <UiColorInput
                    value={colors[token]}
                    onChange={(event) => onChangeThemeColor(token, event.target.value)}
                    className={UI_FIELD_CONTROL_HEIGHT_CLASS}
                  />
                  <UiInput
                    value={colors[token] || DEFAULT_THEME_COLOR_SCHEME[token]}
                    onChange={(event) => onChangeThemeColor(token, event.target.value)}
                    className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} font-mono text-xs uppercase`}
                  />
                </div>
              </div>
            ))}
          </div>
        </UiPanel>
      </div>

      <SettingsDialog
        open={modeDialogOpen}
        title={t('sections.theme.portable.chooseModeTitle')}
        description={t('sections.theme.portable.chooseModeDesc')}
        onClose={() => {
          if (!importing) {
            setModeDialogOpen(false);
            setPendingImportFile(null);
          }
        }}
        actions={[
          {
            label: t('sections.theme.portable.modeAll'),
            onClick: () => {
              void handleModeImport('all');
            },
            variant: 'primary',
          },
          {
            label: t('sections.theme.portable.modeColors'),
            onClick: () => {
              void handleModeImport('colorsOnly');
            },
            variant: 'secondary',
          },
          {
            label: t('sections.theme.portable.modeLayout'),
            onClick: () => {
              void handleModeImport('toneRadiusOnly');
            },
            variant: 'secondary',
          },
          {
            label: t('actions.cancel'),
            onClick: () => {
              if (!importing) {
                setModeDialogOpen(false);
                setPendingImportFile(null);
              }
            },
            variant: 'secondary',
          },
        ]}
      />

      <SettingsDialog
        open={feedbackDialog.open}
        title={t('sections.theme.portable.feedbackTitle')}
        description={feedbackDialog.message}
        onClose={() => setFeedbackDialog({ open: false, message: '' })}
        actions={[
          {
            label: t('actions.confirm'),
            onClick: () => setFeedbackDialog({ open: false, message: '' }),
            variant: 'primary',
          },
        ]}
      />
    </SectionCard>
  );
};

export default ThemeSection;
