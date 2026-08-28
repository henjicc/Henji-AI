import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  CompositePanelDef,
  DropdownParamDef,
  FileUploadParamDef,
  ImageUploadParamDef,
  NumberParamDef,
  ParamDef,
  RadioParamDef,
  SwitchParamDef,
  TextParamDef,
} from '@/core/types';
import { getI18nText } from '@/core/types/I18nText';
import { panelRegistry } from '@/core/panels/PanelRegistry';
import {
  formatAspectRatioDisplayLabel,
  isAspectRatioChoiceParam,
  isSmartAspectValue,
} from '@/core/params/ratioResolution';
import Dropdown from '@/components/ui/Dropdown';
import NumberField from '@/components/ui/NumberInput';
import PanelTrigger from '@/components/ui/PanelTrigger';
import { AspectRatioSelector } from '@/components/params/panels/ResolutionPanel/AspectRatioSelector';
import type { AspectRatioOption } from '@/components/params/panels/ResolutionPanel/types';
import { PromptEditor, UiInput, UiSwitch } from '@/components/ui';
import { formatPanelDisplayValue, resolvePanelWidth } from '@/components/params/panelDisplay';
import { FileUpload, ImageUpload } from '@/components/params/upload';
import { useCanvasTextHistory } from '@/features/canvas/hooks/useCanvasTextHistory';
import {
  resolveTextParamPromptDocument,
  resolveTextParamPromptVariables,
  serializeTextParamPromptDocument,
} from '@/components/params/base/promptTextParam';

interface NodeParamControlProps {
  param: ParamDef;
  value: DynamicValue;
  onChange: (value: DynamicValue) => void;
  historyGroup: string;
  disabled?: boolean;
}

/** 紧凑右对齐控件按钮的通用底座样式 */
const COMPACT_TRIGGER_CLASS = '!h-7 !w-auto !justify-between !gap-1.5 !rounded-md !px-2 !py-0 !text-xs !font-normal';
const COMPACT_TRIGGER_LABEL_CLASS = 'text-xs leading-none';

function CompactNumberControl({
  param,
  value,
  onChange,
  disabled,
}: { param: NumberParamDef; value: DynamicValue; onChange: (value: number) => void; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const safeValue = typeof value === 'number' && Number.isFinite(value)
    ? value
    : (typeof param.default === 'number' ? param.default : (param.min ?? 0));
  const step = typeof param.step === 'number' && Number.isFinite(param.step) && param.step > 0
    ? param.step
    : 1;
  const displayName = getI18nText(param.name, i18n.language);

  return (
    <div
      className="nodrag nowheel"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <NumberField
        value={safeValue}
        onChange={onChange}
        min={param.min}
        max={param.max}
        step={step}
        disabled={disabled}
        size="compact"
        align="right"
        widthClassName="w-[72px]"
        commitOnChange
        ariaLabel={displayName}
        increaseLabel={i18n.language.startsWith('zh') ? `增加${displayName}` : `Increase ${displayName}`}
        decreaseLabel={i18n.language.startsWith('zh') ? `减少${displayName}` : `Decrease ${displayName}`}
      />
    </div>
  );
}

function isSameOptionValue(left: DynamicValue, right: DynamicValue): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }
  return String(left) === String(right);
}

function CompactDropdownControl({
  param,
  value,
  onChange,
  disabled,
}: { param: DropdownParamDef | RadioParamDef; value: DynamicValue; onChange: (value: DynamicValue) => void; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const options = useMemo(
    () => param.options.map((option) => ({
      label: getI18nText(option.label, i18n.language),
      value: option.value,
      disabled: option.disabled === true,
    })),
    [param.options, i18n.language]
  );
  const isUnset = value === undefined || value === null || value === '';
  const effectiveValue = !isUnset ? value : param.default;
  const selected = options.find((option) => isSameOptionValue(option.value, effectiveValue));
  const fallback = options.find((option) => isSameOptionValue(option.value, param.default))
    ?? options.find((option) => !option.disabled);
  const displayOption = selected ?? fallback;

  return (
    <Dropdown
      value={displayOption ? displayOption.value : ''}
      display={displayOption?.label}
      options={options}
      onSelect={onChange}
      disabled={disabled}
      buttonClassName={COMPACT_TRIGGER_CLASS}
      buttonLabelClassName={COMPACT_TRIGGER_LABEL_CLASS}
      optionLabelClassName={COMPACT_TRIGGER_LABEL_CLASS}
      minWidthStrategy="display"
      panelWidthStrategy="options"
    />
  );
}

const ASPECT_PANEL_ITEM_WIDTH = 78;
const ASPECT_PANEL_GAP = 8;
const ASPECT_PANEL_MAX_PER_ROW = 4;
/** 面板内边距（p-3 单侧 12px）+ UI_TRIGGER_PANEL_CLASS 边框（单侧 1px），两侧合计 */
const ASPECT_PANEL_CHROME = (12 + 1) * 2;

function estimateAspectPanelWidth(itemCount: number): number {
  const columns = Math.max(1, Math.min(ASPECT_PANEL_MAX_PER_ROW, itemCount));
  const contentWidth = columns * ASPECT_PANEL_ITEM_WIDTH + ASPECT_PANEL_GAP * (columns - 1);
  return contentWidth + ASPECT_PANEL_CHROME;
}

/** 比例下拉的特殊面板：把"16:9"这类纯文字选项换成矩形比例预览，点开即可直观比对 */
function CompactAspectRatioControl({
  param,
  value,
  onChange,
  disabled,
}: { param: DropdownParamDef | RadioParamDef; value: DynamicValue; onChange: (value: DynamicValue) => void; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const smartOption = useMemo(
    () => param.options.find((option) => isSmartAspectValue(option.value)),
    [param.options]
  );
  const aspectOptions = useMemo<AspectRatioOption[]>(
    () => param.options
      .filter((option) => option !== smartOption)
      .map((option) => ({ value: String(option.value), label: option.label })),
    [param.options, smartOption]
  );
  const isUnset = value === undefined || value === null || value === '';
  const effectiveValue = !isUnset ? value : param.default;
  const selectedOption = param.options.find((option) => isSameOptionValue(option.value, effectiveValue));
  const display = selectedOption
    ? formatAspectRatioDisplayLabel(getI18nText(selectedOption.label, i18n.language), selectedOption.value)
    : String(effectiveValue ?? '');
  const selectorValue = selectedOption && isSmartAspectValue(selectedOption.value)
    ? 'smart'
    : String(effectiveValue ?? '');
  const panelWidth = estimateAspectPanelWidth(aspectOptions.length + (smartOption ? 1 : 0));

  return (
    <PanelTrigger
      display={display}
      disabled={disabled}
      buttonClassName={COMPACT_TRIGGER_CLASS}
      buttonLabelClassName={COMPACT_TRIGGER_LABEL_CLASS}
      panelWidth={panelWidth}
      alignment="aboveCenter"
      gap={8}
      closeOnPanelClick
      renderPanel={() => (
        <div className="p-3">
          <AspectRatioSelector
            value={selectorValue}
            onChange={(next) => {
              if (next === 'smart' && smartOption) {
                onChange(smartOption.value);
                return;
              }
              onChange(next);
            }}
            options={aspectOptions}
            smartMatchEnabled={Boolean(smartOption)}
          />
        </div>
      )}
    />
  );
}

function CompactTextControl({
  param,
  value,
  onChange,
  historyGroup,
  disabled,
}: { param: TextParamDef; value: DynamicValue; onChange: (value: string) => void; historyGroup: string; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const placeholder = getI18nText(param.placeholder || '', i18n.language);
  const textHistory = useCanvasTextHistory(historyGroup, onChange);
  const textValue = typeof value === 'string' ? value : '';
  const promptVariables = useMemo(
    () => resolveTextParamPromptVariables(param, i18n.language),
    [i18n.language, param]
  );
  const promptDocument = useMemo(
    () => resolveTextParamPromptDocument(textValue, promptVariables),
    [promptVariables, textValue]
  );

  if (param.editor?.kind === 'prompt') {
    return (
      <PanelTrigger
        display={textValue || placeholder || '编辑提示词'}
        disabled={disabled}
        buttonClassName={`${COMPACT_TRIGGER_CLASS} max-w-32`}
        buttonLabelClassName={`${COMPACT_TRIGGER_LABEL_CLASS} max-w-24 truncate`}
        panelWidth={360}
        alignment="aboveCenter"
        gap={8}
        closeOnPanelClick={false}
        panelClassName="overflow-hidden"
        renderPanel={() => (
          <div className="flex h-60 min-h-0 flex-col p-3">
            <PromptEditor
              value={promptDocument}
              onChange={(document) => textHistory.onValueChange(
                serializeTextParamPromptDocument(document)
              )}
              onEditEnd={textHistory.onEditEnd}
              preset={param.editor?.preset ?? 'plain'}
              layout="fill-scroll"
              variables={promptVariables}
              ariaLabel={placeholder || '提示词参数'}
              placeholder={placeholder}
              disabled={disabled}
              autoFocus
              maxCharacters={param.maxLength}
              showCharacterCount={param.maxLength !== undefined}
              editorClassName="ui-scrollbar"
            />
          </div>
        )}
      />
    );
  }

  return (
    <UiInput
      type="text"
      value={textValue}
      placeholder={placeholder}
      onChange={(event) => textHistory.onValueChange(event.target.value)}
      textHistory={textHistory}
      onMouseDown={(event) => event.stopPropagation()}
      disabled={disabled}
      className="h-7 w-32 px-2 text-xs"
    />
  );
}

function CompactPanelControl({
  param,
  value,
  onChange,
  disabled,
}: { param: CompositePanelDef; value: DynamicValue; onChange: (value: DynamicValue) => void; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const PanelComponent = param.panel ? panelRegistry.get(param.panel) : undefined;
  const display = formatPanelDisplayValue(value, param.panel ?? 'composite', i18n.language, param.config);

  if (!PanelComponent) {
    return <span className="text-xs text-text-muted">{display}</span>;
  }

  const panelWidth = resolvePanelWidth(param.config, param.panel === 'resolution' ? 400 : 320);

  return (
    <PanelTrigger
      display={display}
      disabled={disabled}
      buttonClassName={COMPACT_TRIGGER_CLASS}
      buttonLabelClassName={COMPACT_TRIGGER_LABEL_CLASS}
      panelWidth={panelWidth}
      alignment="aboveCenter"
      gap={8}
      closeOnPanelClick={false}
      freezePositionOnOpen={param.panel === 'voice-selector'}
      renderPanel={() => (
        <PanelComponent value={value} onChange={onChange} config={param.config} />
      )}
    />
  );
}

function CompactUploadControl({
  param,
  value,
  onChange,
  disabled,
}: {
  param: ImageUploadParamDef | FileUploadParamDef;
  value: DynamicValue;
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : (typeof value === 'string' && value.trim() ? [value.trim()] : []);
  const display = values.length > 0
    ? (i18n.language.startsWith('zh') ? `已选 ${values.length} 个` : `${values.length} selected`)
    : (i18n.language.startsWith('zh') ? '上传' : 'Upload');

  return (
    <PanelTrigger
      display={display}
      disabled={disabled}
      buttonClassName={COMPACT_TRIGGER_CLASS}
      buttonLabelClassName={COMPACT_TRIGGER_LABEL_CLASS}
      panelWidth={280}
      alignment="aboveCenter"
      gap={8}
      closeOnPanelClick={false}
      renderPanel={() => (
        <div className="p-3">
          {param.type === 'image-upload' ? (
            <ImageUpload param={param} value={values} onChange={onChange} disabled={disabled} showLabel={false} />
          ) : (
            <FileUpload param={param} value={values} onChange={onChange} disabled={disabled} showLabel={false} />
          )}
        </div>
      )}
    />
  );
}

/**
 * ComfyUI 风格紧凑右对齐参数控件：每个参数渲染为单行右侧的小尺寸控件。
 * 不复用对话模式 ParamRenderer 的"标签在上、控件占满整行"布局——
 * 标签由调用方（行容器）渲染在左侧，本组件只负责右侧取值控件。
 * 仅直接复用底层 primitive（Dropdown/UiInput/UiSwitch/PanelTrigger），
 * 不复用 TextInput/NumberInput/DropdownInput/SwitchInput（它们自带整行标签布局）。
 */
export function NodeParamControl({ param, value, onChange, historyGroup, disabled }: NodeParamControlProps) {
  const { t } = useTranslation();

  switch (param.type) {
    case 'text':
    case 'textarea':
      return (
        <CompactTextControl
          param={param as TextParamDef}
          value={value}
          onChange={onChange as (value: string) => void}
          historyGroup={historyGroup}
          disabled={disabled}
        />
      );
    case 'number':
      return (
        <CompactNumberControl
          param={param as NumberParamDef}
          value={value}
          onChange={onChange as (value: number) => void}
          disabled={disabled}
        />
      );
    case 'switch':
      return (
        <UiSwitch
          appearance="segmented"
          checked={Boolean(value ?? (param as SwitchParamDef).default)}
          onCheckedChange={onChange}
          offLabel={t('common:off', '关')}
          onLabel={t('common:on', '开')}
          size="compact"
          disabled={disabled}
        />
      );
    case 'dropdown':
    case 'radio':
      if (isAspectRatioChoiceParam(param)) {
        return (
          <CompactAspectRatioControl
            param={param as DropdownParamDef | RadioParamDef}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      return (
        <CompactDropdownControl
          param={param as DropdownParamDef | RadioParamDef}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'composite':
      return (
        <CompactPanelControl
          param={param as CompositePanelDef}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'image-upload':
    case 'file-upload':
      return (
        <CompactUploadControl
          param={param as ImageUploadParamDef | FileUploadParamDef}
          value={value}
          onChange={onChange as (value: string[]) => void}
          disabled={disabled}
        />
      );
    default:
      return null;
  }
}
