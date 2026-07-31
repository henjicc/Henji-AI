import React from 'react';
import Dropdown from '@/components/ui/Dropdown';
import {
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_FORM_ROW_GAP_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiColorInput,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiInput,
  UiOptionButton,
  UiPanel,
  UiSwitch,
} from '@/components/ui';
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout';
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
    <>
      <div className={UI_FORM_ROW_GAP_CLASS}>
        <UiFormRow label={t('sections.theme.tone.label')} inline>
          <Dropdown
            value={themeTonePreset}
            options={toneOptions}
            display={toneOptions.find((option) => option.value === themeTonePreset)?.label}
            onSelect={(value) => onChangeThemeTone(value as ThemeTonePreset)}
            className={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>

        <UiFormRow label={t('sections.theme.radius.label')} inline>
          <Dropdown
            value={uiRadiusPreset}
            options={radiusOptions}
            display={radiusOptions.find((option) => option.value === uiRadiusPreset)?.label}
            onSelect={(value) => onChangeUiRadius(value as UiRadiusPreset)}
            className={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>

        {/* 常驻说明：关掉不只是"没模糊"，还会少一层合成开销，是有取舍的选择 */}
        <UiFormRow
          label={t('sections.theme.blur.label')}
          hint={t('sections.theme.blur.hint')}
          inline
        >
          <UiSwitch checked={uiBlurEnabled} onCheckedChange={onChangeUiBlurEnabled} />
        </UiFormRow>
      </div>

      <UiGroup title={t('sections.theme.palette.label')} titleTone="overline">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {/*
              色板是「≥3 个由 map 渲染的同质选项」，且每项自带名字 + 色点撑得出形状，
              按选项集合规则静息态不描边：二维网格补一层 veil 撑格子即可。
              原来用 `UiButton variant="muted"`（border + bg-surface-dark），在玻璃弹窗里
              形成"弹窗 → 按钮 → 色点"三层表面叠加，巡检的表面叠层规则会直接命中。
            */}
            {THEME_PALETTE_PRESETS.map((preset) => (
              <UiOptionButton
                key={preset.id}
                type="button"
                variant="menu"
                className="h-auto flex-col items-start gap-1.5 bg-veil-faint px-2 py-2"
                onClick={() => onApplyPalette(preset.colors)}
              >
                <div className={UI_TEXT_LABEL_CLASS}>
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
              </UiOptionButton>
            ))}
        </div>
      </UiGroup>

      <UiGroup
        title={t('sections.theme.accent.label')}
        titleTone="overline"
        actions={
          <UiButton variant="ghost" size="sm" className="h-7 px-2 text-2xs" onClick={onResetThemeColors}>
            {t('actions.resetDefault')}
          </UiButton>
        }
      >
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
            className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} ml-1`}
          />
          <UiInput
            value={accentColor}
            onChange={(event) => onChangeAccentColor(event.target.value)}
            className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} !w-28 font-mono text-xs uppercase`}
          />
        </div>
      </UiGroup>

      <UiGroup title={t('sections.theme.portable.label')} titleTone="overline">
        <div className="flex flex-wrap items-center gap-2">
          <UiButton variant="muted" size="sm" className="px-4" onClick={onExportTheme}>
            {t('sections.theme.portable.export')}
          </UiButton>
          <UiButton
            variant="muted"
            size="sm"
            className="px-4"
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
      </UiGroup>

      {/* 九个色令牌是「同构重复单元」，保留分块；但块本身要比页面更暗，不是更亮的卡片 */}
      <UiGroup title={t('sections.theme.advanced.label')} titleTone="overline">
        <div className="grid grid-cols-1 gap-3">
          {THEME_COLOR_TOKENS.map((token) => (
            <UiPanel key={token} variant="inset" className="p-2">
              <div className={`mb-2 ${UI_TEXT_META_CLASS}`}>{t(tokenLabelKeyMap[token])}</div>
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
                  className={UI_FIELD_CONTROL_HEIGHT_SM_CLASS}
                />
                <UiInput
                  value={colors[token] || DEFAULT_THEME_COLOR_SCHEME[token]}
                  onChange={(event) => onChangeThemeColor(token, event.target.value)}
                  className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} font-mono text-xs uppercase`}
                />
              </div>
            </UiPanel>
          ))}
        </div>
      </UiGroup>

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
    </>
  );
};

export default ThemeSection;
