import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  CompositePanelDef,
  DropdownParamDef,
  NumberParamDef,
  ParamDef,
  RadioParamDef,
  SwitchParamDef,
  TextParamDef,
} from '@/core/types';
import { getI18nText } from '@/core/types/I18nText';
import { panelRegistry } from '@/core/panels/PanelRegistry';
import Dropdown from '@/components/ui/Dropdown';
import PanelTrigger from '@/components/ui/PanelTrigger';
import { UiIconButton, UiInput, UiSwitch } from '@/components/ui';
import { formatPanelDisplayValue, resolvePanelWidth } from '@/components/params/panelDisplay';

interface NodeParamControlProps {
  param: ParamDef;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

/** 紧凑右对齐控件按钮的通用底座样式 */
const COMPACT_TRIGGER_CLASS = '!h-7 !w-auto !justify-between !gap-1.5 !rounded-md !px-2 !py-0 !text-xs !font-normal';
const COMPACT_TRIGGER_LABEL_CLASS = 'text-xs leading-none';

function resolvePrecision(step: number | undefined): number {
  if (typeof step !== 'number' || !Number.isFinite(step)) {
    return 0;
  }
  const fraction = String(step).split('.')[1];
  return fraction ? fraction.length : 0;
}

function clampNumber(raw: number, param: NumberParamDef): number {
  let next = raw;
  if (typeof param.min === 'number') {
    next = Math.max(param.min, next);
  }
  if (typeof param.max === 'number') {
    next = Math.min(param.max, next);
  }
  const precision = resolvePrecision(param.step);
  if (precision <= 0) {
    return next;
  }
  const factor = 10 ** precision;
  return Math.round(next * factor) / factor;
}

function CompactNumberControl({
  param,
  value,
  onChange,
  disabled,
}: { param: NumberParamDef; value: unknown; onChange: (value: number) => void; disabled?: boolean }) {
  const safeValue = typeof value === 'number' && Number.isFinite(value)
    ? clampNumber(value, param)
    : clampNumber(typeof param.default === 'number' ? param.default : (param.min ?? 0), param);
  const [draft, setDraft] = useState(() => String(safeValue));
  const [focused, setFocused] = useState(false);
  const step = typeof param.step === 'number' && Number.isFinite(param.step) && param.step > 0
    ? param.step
    : 1;

  useEffect(() => {
    if (!focused) {
      setDraft(String(safeValue));
    }
  }, [focused, safeValue]);

  const commitDraft = () => {
    setFocused(false);
    const parsed = Number.parseFloat(draft);
    const next = Number.isFinite(parsed) ? clampNumber(parsed, param) : safeValue;
    setDraft(String(next));
    onChange(next);
  };

  const stepBy = (direction: 1 | -1) => {
    const parsed = Number.parseFloat(draft);
    const base = Number.isFinite(parsed) ? parsed : safeValue;
    const next = clampNumber(base + direction * step, param);
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div
      className="nodrag nowheel flex h-7 w-[72px] overflow-hidden rounded-md border border-border-dark bg-surface-dark"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <UiInput
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            stepBy(1);
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            stepBy(-1);
          }
        }}
        disabled={disabled}
        className="!h-full !min-h-0 w-11 min-w-0 rounded-none !border-0 !bg-transparent px-2 text-right text-xs leading-none"
      />
      <div className="flex w-5 shrink-0 flex-col border-l border-border-dark">
        <UiIconButton
          type="button"
          showBorder={false}
          disabled={disabled}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            stepBy(1);
          }}
          className="!h-3.5 !w-5 !rounded-none !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-layer hover:!text-text-dark"
        >
          <ChevronUp className="h-3 w-3" />
        </UiIconButton>
        <UiIconButton
          type="button"
          showBorder={false}
          disabled={disabled}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            stepBy(-1);
          }}
          className="!h-3.5 !w-5 !rounded-none !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-layer hover:!text-text-dark"
        >
          <ChevronDown className="h-3 w-3" />
        </UiIconButton>
      </div>
    </div>
  );
}

function isSameOptionValue(left: unknown, right: unknown): boolean {
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
}: { param: DropdownParamDef | RadioParamDef; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
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

function CompactTextControl({
  param,
  value,
  onChange,
  disabled,
}: { param: TextParamDef; value: unknown; onChange: (value: string) => void; disabled?: boolean }) {
  const { i18n } = useTranslation();
  const placeholder = getI18nText(param.placeholder || '', i18n.language);
  return (
    <UiInput
      type="text"
      value={typeof value === 'string' ? value : ''}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
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
}: { param: CompositePanelDef; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
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
      closeOnPanelClick={false}
      freezePositionOnOpen={param.panel === 'voice-selector'}
      renderPanel={() => (
        <PanelComponent value={value} onChange={onChange} config={param.config} />
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
export function NodeParamControl({ param, value, onChange, disabled }: NodeParamControlProps) {
  switch (param.type) {
    case 'text':
    case 'textarea':
      return (
        <CompactTextControl
          param={param as TextParamDef}
          value={value}
          onChange={onChange as (value: string) => void}
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
          checked={Boolean(value ?? (param as SwitchParamDef).default)}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      );
    case 'dropdown':
    case 'radio':
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
    default:
      return null;
  }
}
