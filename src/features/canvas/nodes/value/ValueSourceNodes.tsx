import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type ValueSourceNodeData } from '@/features/canvas/domain/canvasNodes';
import NumberField from '@/components/ui/NumberInput';
import { UiSwitch, UiTextArea } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { createCanvasTextHistoryGroup, useCanvasTextHistory } from '@/features/canvas/hooks/useCanvasTextHistory';
import { ValueSourceShell } from './ValueSourceShell';
import {
  ICON_NODE_BOOLEAN,
  ICON_NODE_FLOAT,
  ICON_NODE_INTEGER,
  ICON_NODE_TEXT,
} from '@/core/theme/icons';

const IntegerIcon = ICON_NODE_INTEGER;
const FloatIcon = ICON_NODE_FLOAT;
const TextIcon = ICON_NODE_TEXT;
const BooleanIcon = ICON_NODE_BOOLEAN;

type ValueNodeProps = NodeProps & {
  id: string;
  data: ValueSourceNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

function useSetValue(id: string, historyGroup?: string): (value: number | string | boolean) => void {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  return useCallback(
    (value: number | string | boolean) => updateNodeData(id, { value }, historyGroup ? { historyGroup } : undefined),
    [historyGroup, id, updateNodeData]
  );
}

function NumberValueField({
  value,
  integer,
  onCommit,
  historyGroup,
}: {
  value: number;
  integer: boolean;
  onCommit: (value: number) => void;
  historyGroup: string;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const commit = useCallback((raw: number) => {
    const next = integer ? Math.round(raw) : raw;
    onCommit(Number.isFinite(next) ? next : 0);
  }, [integer, onCommit]);
  const handleRawChange = useCallback((rawValue: string): void => {
    const parsed = integer
      ? Number.parseInt(rawValue, 10)
      : Number.parseFloat(rawValue);
    commit(parsed);
  }, [commit, integer]);
  const textHistory = useCanvasTextHistory(historyGroup, handleRawChange);

  return (
    <div
      className="nodrag nowheel w-full"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <NumberField
        value={safeValue}
        onChange={commit}
        step={integer ? 1 : 0.1}
        precision={integer ? 0 : 1}
        size="compact"
        align="right"
        widthClassName="w-full"
        commitOnChange
        textHistory={textHistory}
        ariaLabel={integer ? '整数值' : '小数值'}
        increaseLabel={integer ? '增加整数值' : '增加小数值'}
        decreaseLabel={integer ? '减少整数值' : '减少小数值'}
      />
    </div>
  );
}

export const IntSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const historyGroup = createCanvasTextHistoryGroup(id, 'value');
  const setValue = useSetValue(id, historyGroup);
  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.intSource}
      data={data}
      socketType="INT"
      selected={selected}
      width={width}
      height={height}
      minWidth={128}
      minHeight={56}
      icon={<IntegerIcon className="h-4 w-4" />}
    >
      <NumberValueField value={Number(data.value)} integer onCommit={setValue} historyGroup={historyGroup} />
    </ValueSourceShell>
  );
});
IntSourceNode.displayName = 'IntSourceNode';

export const FloatSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const historyGroup = createCanvasTextHistoryGroup(id, 'value');
  const setValue = useSetValue(id, historyGroup);
  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.floatSource}
      data={data}
      socketType="FLOAT"
      selected={selected}
      width={width}
      height={height}
      minWidth={128}
      minHeight={56}
      icon={<FloatIcon className="h-4 w-4" />}
    >
      <NumberValueField value={Number(data.value)} integer={false} onCommit={setValue} historyGroup={historyGroup} />
    </ValueSourceShell>
  );
});
FloatSourceNode.displayName = 'FloatSourceNode';

export const StringSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const historyGroup = createCanvasTextHistoryGroup(id, 'value');
  const setValue = useSetValue(id, historyGroup);
  const handleValueChange = useCallback((nextValue: string): void => setValue(nextValue), [setValue]);
  const textHistory = useCanvasTextHistory(historyGroup, handleValueChange);
  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.stringSource}
      data={data}
      socketType="STRING"
      selected={selected}
      width={width ?? 300}
      height={height ?? 132}
      minWidth={240}
      minHeight={116}
      icon={<TextIcon className="h-4 w-4" />}
    >
      <UiTextArea
        value={typeof data.value === 'string' ? data.value : ''}
        onChange={(event) => textHistory.onValueChange(event.target.value)}
        textHistory={textHistory}
        onMouseDown={(event) => event.stopPropagation()}
        className="ui-scrollbar min-h-0 flex-1 resize-none"
      />
    </ValueSourceShell>
  );
});
StringSourceNode.displayName = 'StringSourceNode';

export const BooleanSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const setValue = useSetValue(id);
  const { t } = useTranslation();
  const checked = Boolean(data.value);
  const offLabel = t('common:off', '关');
  const onLabel = t('common:on', '开');

  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.booleanSource}
      data={data}
      socketType="BOOLEAN"
      selected={selected}
      width={width}
      height={height}
      minHeight={56}
      icon={<BooleanIcon className="h-4 w-4" />}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{checked ? onLabel : offLabel}</span>
        <UiSwitch
          appearance="segmented"
          checked={checked}
          onCheckedChange={setValue}
          offLabel={offLabel}
          onLabel={onLabel}
          size="compact"
        />
      </div>
    </ValueSourceShell>
  );
});
BooleanSourceNode.displayName = 'BooleanSourceNode';
