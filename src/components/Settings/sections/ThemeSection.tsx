import React from 'react';
import Dropdown from '@/components/ui/Dropdown';
import {
  UI_FORM_ROW_GAP_CLASS,
  UI_SEGMENTED_TRACK_CLASS,
  UiButton,
  UiColorInput,
  UiFormRow,
  UiGroup,
  UiInput,
  UiOptionButton,
  UiSwitch,
} from '@/components/ui';
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout';
import { useI18n } from '@/hooks/useI18n';
import type { UiRadiusPreset } from '@/core/theme/runtimeTheme';
import {
  THEME_ACCENT_CHOICES,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  deriveThemeTokens,
  type ThemeContrastLevel,
  type ThemeSeed,
} from '@/core/theme/themeEngine';
import {
  THEME_CONTRAST_LEVEL_IDS,
  THEME_CUSTOM_PRESET,
  resolveThemeBaseSeed,
  resolveThemeSelection,
  type ThemeSelection,
  type ThemeSelectionPreset,
} from '@/core/theme/themeSelection';
import { useSettingsStore, type ThemeImportMode } from '@/stores/settingsStore';
import SettingsDialog from '../components/SettingsDialog';

interface ThemeSectionProps {
  onExportTheme: () => void;
  onImportTheme: (file: File, mode: ThemeImportMode) => Promise<boolean>;
}

type LocalizedName = { zh: string; en: string };

interface PresetSample {
  id: ThemeSelectionPreset;
  name: LocalizedName | null;
  /** 推导后的窗口底色与强调实底（不是种子原值） */
  window: string;
  accent: string;
  edge: string;
}

interface AccentSwatch {
  id: string;
  name: LocalizedName;
  hex: string | null;
  /** 当前底色下推导出的强调实底 */
  fill: string;
}

/** 预设格小样：窗口底色与强调实底沿对角线各占一半（设计稿“主题引擎”预设卡）。 */
function presetSampleStyle(sample: PresetSample): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, ${sample.window} 0 50%, ${sample.accent} 50% 100%)`,
    boxShadow: `inset 0 0 0 1px ${sample.edge}`,
  };
}

function derivedAccent(seed: ThemeSeed): string {
  return deriveThemeTokens(seed).colors.accent;
}

function samplePreset(
  id: ThemeSelectionPreset,
  name: LocalizedName | null,
  selection: ThemeSelection
): PresetSample {
  const { seed, overrides } = resolveThemeSelection({ ...selection, preset: id });
  const colors = deriveThemeTokens(seed, overrides).colors;
  return { id, name, window: colors.window, accent: colors.accent, edge: colors.lineStrong };
}

const ThemeSection: React.FC<ThemeSectionProps> = ({ onExportTheme, onImportTheme }) => {
  const { t, i18n } = useI18n('settings');
  const selection = useSettingsStore((state) => state.themeSelection);
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset);
  const uiBlurEnabled = useSettingsStore((state) => state.uiBlurEnabled);
  const setThemePreset = useSettingsStore((state) => state.setThemePreset);
  const setThemeAccent = useSettingsStore((state) => state.setThemeAccent);
  const setThemeContrast = useSettingsStore((state) => state.setThemeContrast);
  const setUiRadiusPreset = useSettingsStore((state) => state.setUiRadiusPreset);
  const setUiBlurEnabled = useSettingsStore((state) => state.setUiBlurEnabled);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [pendingImportFile, setPendingImportFile] = React.useState<File | null>(null);
  const [modeDialogOpen, setModeDialogOpen] = React.useState(false);
  const [feedbackDialog, setFeedbackDialog] = React.useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  const localize = (name: LocalizedName): string => (i18n.language.startsWith('zh') ? name.zh : name.en);

  // 小样与色样都显示推导后的令牌色：引擎会按对比度微调强调实底，种子原值与按钮实际颜色不一定相同。
  const presetSamples = React.useMemo<PresetSample[]>(() => {
    const samples = THEME_PRESET_IDS.map((id) => samplePreset(id, THEME_PRESETS[id].name, selection));
    if (selection.custom) samples.push(samplePreset(THEME_CUSTOM_PRESET, null, selection));
    return samples;
  }, [selection]);

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

  const radiusOptions: Array<{ value: UiRadiusPreset; label: string }> = [
    { value: 'compact', label: t('sections.theme.radius.compact') },
    { value: 'default', label: t('sections.theme.radius.default') },
    { value: 'large', label: t('sections.theme.radius.large') },
  ];

  const contrastLabels: Record<ThemeContrastLevel, string> = {
    soft: t('sections.theme.contrast.soft'),
    standard: t('sections.theme.contrast.standard'),
    strong: t('sections.theme.contrast.strong'),
  };

  return (
    <>
      <UiGroup title={t('sections.theme.preset.label')} titleTone="overline">
        <div role="radiogroup" aria-label={t('sections.theme.preset.label')} className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {presetSamples.map((sample) => {
            const label = sample.name ? localize(sample.name) : t('sections.theme.preset.custom');
            const active = selection.preset === sample.id;
            return (
              <UiOptionButton
                key={sample.id}
                type="button"
                variant="tile"
                role="radio"
                aria-checked={active}
                active={active}
                onClick={() => setThemePreset(sample.id)}
              >
                <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-md" style={presetSampleStyle(sample)} />
                <span className="truncate">{label}</span>
              </UiOptionButton>
            );
          })}
        </div>
      </UiGroup>

      <UiGroup title={t('sections.theme.accent.label')} titleTone="overline">
        <div role="radiogroup" aria-label={t('sections.theme.accent.label')} className="flex flex-wrap items-center gap-2.5">
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
                title={localize(swatch.name)}
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
              title={t('sections.theme.accent.custom')}
              active
              style={{ backgroundColor: customAccentFill }}
            />
          )}
          <UiColorInput
            value={effectiveAccent.toLowerCase()}
            aria-label={t('sections.theme.accent.pick')}
            title={t('sections.theme.accent.pick')}
            onChange={(event) => setThemeAccent(event.target.value)}
            className="!h-8 !w-8"
          />
        </div>
      </UiGroup>

      {/* 预留：将来的“高级 / 主题编辑器”入口放在这里（开放完整种子，见重要记录 002）；本任务不显示入口。 */}

      <div className={UI_FORM_ROW_GAP_CLASS}>
        <UiFormRow label={t('sections.theme.contrast.label')} info={t('sections.theme.contrast.info')} inline>
          <div role="radiogroup" aria-label={t('sections.theme.contrast.label')} className={UI_SEGMENTED_TRACK_CLASS}>
            {THEME_CONTRAST_LEVEL_IDS.map((level) => (
              <UiOptionButton
                key={level}
                type="button"
                variant="segment"
                role="radio"
                aria-checked={selection.contrast === level}
                active={selection.contrast === level}
                onClick={() => setThemeContrast(level)}
              >
                {contrastLabels[level]}
              </UiOptionButton>
            ))}
          </div>
        </UiFormRow>

        <UiFormRow label={t('sections.theme.radius.label')} inline>
          <Dropdown
            value={uiRadiusPreset}
            options={radiusOptions}
            display={radiusOptions.find((option) => option.value === uiRadiusPreset)?.label}
            onSelect={(value) => setUiRadiusPreset(value as UiRadiusPreset)}
            className={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>

        {/* 常驻说明：关掉不只是"没模糊"，还会少一层合成开销，是有取舍的选择 */}
        <UiFormRow
          label={t('sections.theme.blur.label')}
          hint={t('sections.theme.blur.hint')}
          inline
        >
          <UiSwitch checked={uiBlurEnabled} onCheckedChange={setUiBlurEnabled} />
        </UiFormRow>
      </div>

      <UiGroup title={t('sections.theme.portable.label')} titleTone="overline">
        <div className="flex flex-wrap items-center gap-2">
          <UiButton variant="secondary" className="px-4" onClick={onExportTheme}>
            {t('sections.theme.portable.export')}
          </UiButton>
          <UiButton
            variant="secondary"
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
