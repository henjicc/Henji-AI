import React from 'react';
import {
  UiButton,
  UiColorInput,
  UiFormRow,
  UiGroup,
  UiInput,
  UiOptionButton,
  UiRangeInput,
} from '@/components/ui';
import SettingsSegmented from '../components/SettingsSegmented';
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout';
import UiScaleSection from './UiScaleSection';
import { useI18n } from '@/hooks/useI18n';
import { UI_RADIUS_RANGE } from '@/core/theme/uiRadius';
import {
  THEME_ACCENT_CHOICES,
  deriveThemeTokens,
  type ThemeContrastLevel,
  type ThemeSeed,
} from '@/core/theme/themeEngine';
import {
  THEME_CONTRAST_LEVEL_IDS,
  THEME_CUSTOM_PRESET,
  resolveThemeBaseSeed,
  resolveThemeSelection,
  type ThemeSelectionPreset,
} from '@/core/theme/themeSelection';
import { useSettingsStore, type ThemeImportMode } from '@/stores/settingsStore';
import SettingsDialog from '../components/SettingsDialog';

interface ThemeSectionProps {
  onExportTheme: () => void;
  onImportTheme: (file: File, mode: ThemeImportMode) => Promise<boolean>;
}

type LocalizedName = { zh: string; en: string };

interface AccentSwatch {
  id: string;
  name: LocalizedName;
  hex: string | null;
  /** 当前底色下推导出的强调实底 */
  fill: string;
}

function derivedAccent(seed: ThemeSeed): string {
  return deriveThemeTokens(seed).colors.accent;
}

const ThemeSection: React.FC<ThemeSectionProps> = ({ onExportTheme, onImportTheme }) => {
  const { t, i18n } = useI18n('settings');
  const selection = useSettingsStore((state) => state.themeSelection);
  const uiRadius = useSettingsStore((state) => state.uiRadius);
  const setThemePreset = useSettingsStore((state) => state.setThemePreset);
  const setThemeAccent = useSettingsStore((state) => state.setThemeAccent);
  const setThemeContrast = useSettingsStore((state) => state.setThemeContrast);
  const setUiRadius = useSettingsStore((state) => state.setUiRadius);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [pendingImportFile, setPendingImportFile] = React.useState<File | null>(null);
  const [modeDialogOpen, setModeDialogOpen] = React.useState(false);
  const [feedbackDialog, setFeedbackDialog] = React.useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  const localize = (name: LocalizedName): string => (i18n.language.startsWith('zh') ? name.zh : name.en);

  // 只有深色（石墨）与浅色（纸白）；自定义底色只来自导入的主题文件，存在时才出现。
  const presetOptions: Array<{ value: ThemeSelectionPreset; label: string }> = [
    { value: 'graphite', label: t('sections.theme.preset.dark') },
    { value: 'paper', label: t('sections.theme.preset.light') },
    ...(selection.custom ? [{ value: THEME_CUSTOM_PRESET, label: t('sections.theme.preset.custom') }] : []),
  ];

  // 色样显示推导后的令牌色：引擎会按对比度微调强调实底，种子原值与按钮实际颜色不一定相同。
  const accentSwatches = React.useMemo<AccentSwatch[]>(() => {
    const base = resolveThemeBaseSeed(selection);
    return THEME_ACCENT_CHOICES.map((choice) => ({
      id: choice.id,
      name: choice.name,
      hex: choice.hex,
      fill: derivedAccent({ ...base, accent: choice.hex ?? base.accent }),
    }));
  }, [selection]);

  const customAccentActive = selection.accent !== null
    && !THEME_ACCENT_CHOICES.some((choice) => choice.hex === selection.accent);
  const effectiveAccent = resolveThemeSelection(selection).seed.accent;
  const customAccentFill = React.useMemo(
    () => (customAccentActive ? derivedAccent({ ...resolveThemeBaseSeed(selection), accent: effectiveAccent }) : null),
    [customAccentActive, effectiveAccent, selection]
  );

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

  const contrastLabels: Record<ThemeContrastLevel, string> = {
    soft: t('sections.theme.contrast.soft'),
    standard: t('sections.theme.contrast.standard'),
    strong: t('sections.theme.contrast.strong'),
  };

  return (
    <>
      <UiGroup>
        <UiFormRow label={t('sections.theme.preset.label')} inline>
          <SettingsSegmented<ThemeSelectionPreset>
            value={selection.preset}
            options={presetOptions}
            onChange={setThemePreset}
            ariaLabel={t('sections.theme.preset.label')}
          />
        </UiFormRow>
      </UiGroup>

      <UiGroup title={t('sections.theme.accent.label')} titleTone="overline">
        <div role="radiogroup" aria-label={t('sections.theme.accent.label')} className="flex flex-wrap items-center gap-3">
          {accentSwatches.map((swatch) => {
            const active = swatch.hex === null ? selection.accent === null : selection.accent === swatch.hex;
            return (
              <UiOptionButton
                key={swatch.id}
                type="button"
                variant="swatch"
                role="radio"
                aria-checked={active}
                aria-label={localize(swatch.name)}
                tooltip={localize(swatch.name)}
                active={active}
                onClick={() => setThemeAccent(swatch.hex)}
                // 跟随预设：一半是预设强调色、一半是辅助文字灰，和具体颜色区分开
                style={swatch.hex === null
                  ? { backgroundImage: `conic-gradient(${swatch.fill} 0 50%, var(--text3) 50% 100%)` }
                  : { backgroundColor: swatch.fill }}
              />
            );
          })}
          {customAccentFill && (
            <UiOptionButton
              type="button"
              variant="swatch"
              role="radio"
              aria-checked
              aria-label={t('sections.theme.accent.custom')}
              tooltip={t('sections.theme.accent.custom')}
              active
              style={{ backgroundColor: customAccentFill }}
            />
          )}
          <UiColorInput
            value={effectiveAccent.toLowerCase()}
            aria-label={t('sections.theme.accent.pick')}
            title={t('sections.theme.accent.pick')}
            onChange={(event) => setThemeAccent(event.target.value)}
          />
        </div>
      </UiGroup>

      {/* 预留：将来的“高级 / 主题编辑器”入口放在这里（开放完整种子，见重要记录 002）；本任务不显示入口。 */}

      <UiGroup>
        <UiFormRow label={t('sections.theme.contrast.label')} info={t('sections.theme.contrast.info')} inline>
          <SettingsSegmented<ThemeContrastLevel>
            value={selection.contrast}
            options={THEME_CONTRAST_LEVEL_IDS.map((level) => ({ value: level, label: contrastLabels[level] }))}
            onChange={setThemeContrast}
            ariaLabel={t('sections.theme.contrast.label')}
          />
        </UiFormRow>

        <UiFormRow label={t('sections.theme.radius.label', { value: uiRadius })} inline>
          <UiRangeInput
            min={UI_RADIUS_RANGE.min}
            max={UI_RADIUS_RANGE.max}
            step={UI_RADIUS_RANGE.step}
            value={uiRadius}
            onChange={(event) => setUiRadius(Number(event.target.value))}
            aria-label={t('sections.theme.radius.aria')}
            className={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>

        <UiScaleSection />
      </UiGroup>

      <UiGroup>
        <UiFormRow label={t('sections.theme.portable.label')} inline>
        <div className="flex flex-wrap items-center gap-2">
          <UiButton variant="secondary" onClick={onExportTheme}>
            {t('sections.theme.portable.export')}
          </UiButton>
          <UiButton
            variant="secondary"
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
        </UiFormRow>
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
            label: t('sections.theme.portable.modeRadius'),
            onClick: () => {
              void handleModeImport('radiusOnly');
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
