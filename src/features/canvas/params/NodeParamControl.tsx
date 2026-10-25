import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AspectRatioParamDef,
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
import { AspectRatioTiles, type AspectRatioTileOption } from '@/components/params/panels/ResolutionPanel/AspectRatioTiles';
import { parseRatio } from '@/components/MediaGenerator/components/aspectResolutionPanelUtils';
import { PromptEditor, UiInput, UiSpecialPanel, UiSwitch } from '@/components/ui';
import { formatPanelDisplayValue } from '@/components/params/panelDisplay';
import { FileUpload, ImageUpload } from '@/components/params/upload';
import { DerivedMediaParamControl } from '@/components/params/DerivedMediaParamControl';
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
  allValues: DynamicValueMap;
  onParamChange: (paramId: string, value: DynamicValue) => void;
  onParamChanges: (changes: DynamicValueMap) => void;
  historyGroup: string;
  disabled?: boolean;
}

/** 紧凑右对齐控件按钮的通用底座样式 */
// 画布参数行的紧凑触发器：尺寸走 size="sm"（28），这里只放布局
const COMPACT_TRIGGER_CLASS = 'w-auto'

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
        size="sm"
        align="center"
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
      size="sm"
      buttonClassName={COMPACT_TRIGGER_CLASS}
      surface="glass"
      minWidthStrategy="display"
      panelWidthStrategy="options"
    />
  );
}

/** 比例下拉的特殊面板：把"16:9"这类纯文字选项换成矩形比例预览，点开即可直观比对 */
function CompactAspectRatioControl({
  param,
  value,
  onChange,
  disabled,
}: { param: DropdownParamDef | RadioParamDef | AspectRatioParamDef; value: DynamicValue; onChange: (value: DynamicValue) => void; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const smartOption = useMemo(
    () => param.options.find((option) => isSmartAspectValue(option.value)),
    [param.options]
  );
  const tileOptions = useMemo<AspectRatioTileOption[]>(() => {
    const ratioOptions = param.options
      .filter((option) => option !== smartOption)
      .map((option) => {
        const label = formatAspectRatioDisplayLabel(String(getI18nText(option.label, i18n.language) || option.value), option.value);
        return { value: String(option.value), label, ratio: parseRatio(String(option.value)) ?? parseRatio(label), smart: false };
      });
    return smartOption
      ? [{ value: 'smart', label: getI18nText(smartOption.label, i18n.language) || '智能', ratio: null, smart: true }, ...ratioOptions]
      : ratioOptions;
  }, [i18n.language, param.options, smartOption]);
  const isUnset = value === undefined || value === null || value === '';
  const effectiveValue = !isUnset ? value : param.default;
  const selectedOption = param.options.find((option) => isSameOptionValue(option.value, effectiveValue));
  const display = selectedOption
    ? formatAspectRatioDisplayLabel(getI18nText(selectedOption.label, i18n.language), selectedOption.value)
    : String(effectiveValue ?? '');
  const selectorValue = selectedOption && isSmartAspectValue(selectedOption.value)
    ? 'smart'
    : String(effectiveValue ?? '');

  return (
    <PanelTrigger
      display={display}
      disabled={disabled}
      size="sm"
      buttonClassName={COMPACT_TRIGGER_CLASS}
      surface="glass"
      // 与生成页同一个比例面板（重要记录 021）：宽度跟格子数走，在触发器下方展开、不盖住这一行
      panelSize="special"
      alignment="bottomRight"
      closeOnPanelClick
      renderPanel={() => (
        <UiSpecialPanel>
          <AspectRatioTiles
            options={tileOptions}
            isActive={(option) => String(option.value) === selectorValue}
            onSelect={(option) => onChange(option.smart && smartOption ? smartOption.value : option.value)}
          />
        </UiSpecialPanel>
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
        size="sm"
        buttonClassName={`${COMPACT_TRIGGER_CLASS} max-w-32`}
        surface="glass"
        panelSize="compact"
        alignment="aboveCenter"
        gap={8}
        closeOnPanelClick={false}
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
      size="sm" className="w-32"
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
  const display = formatPanelDisplayValue(value, param.panel ?? 'composite', i18n.language, param.config, param.default);

  if (!PanelComponent) {
    return <span className="text-xs text-text2">{display}</span>;
  }

  return (
    <PanelTrigger
      display={display}
      disabled={disabled}
      size="sm"
      buttonClassName={COMPACT_TRIGGER_CLASS}
      surface="glass"
      // 特殊面板（重要记录 021）：宽度量面板里最宽的内容，在这一行下面展开
      panelSize="special"
      alignment="bottomRight"
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
      size="sm"
      buttonClassName={COMPACT_TRIGGER_CLASS}
      surface="glass"
      panelSize="compact"
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
export function NodeParamControl({ param, value, onChange, allValues, onParamChange, onParamChanges, historyGroup, disabled }: NodeParamControlProps) {
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
          size="sm"
          disabled={disabled}
        />
      );
    case 'aspect-ratio':
      return <CompactAspectRatioControl param={param} value={value} onChange={onChange} disabled={disabled} />;
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
      if ((param as ImageUploadParamDef).derivedMediaAuthoring) {
        return (
          <DerivedMediaParamControl
            param={param as ImageUploadParamDef}
            value={value}
            allValues={allValues}
            onChange={onChange as (value: string[]) => void}
            onParamChange={onParamChange}
            onParamChanges={onParamChanges}
            disabled={disabled}
            compact
          />
        );
      }
      return (
        <CompactUploadControl
          param={param as ImageUploadParamDef}
          value={value}
          onChange={onChange as (value: string[]) => void}
          disabled={disabled}
        />
      );
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
