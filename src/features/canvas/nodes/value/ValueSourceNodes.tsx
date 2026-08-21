import { memo, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type ValueSourceNodeData } from '@/features/canvas/domain/canvasNodes';
import { UiIconButton, UiInput, UiSwitch, UiTextArea } from '@/components/ui';
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
  const stepBy = useCallback((direction: 1 | -1) => {
    commit(safeValue + direction * (integer ? 1 : 0.1));
  }, [commit, integer, safeValue]);
  const handleRawChange = useCallback((rawValue: string): void => {
    const parsed = integer
      ? Number.parseInt(rawValue, 10)
      : Number.parseFloat(rawValue);
    commit(parsed);
  }, [commit, integer]);
  const textHistory = useCanvasTextHistory(historyGroup, handleRawChange);

  return (
    <div
      className="nodrag nowheel flex h-8 w-full overflow-hidden rounded-md border border-border-dark bg-surface-dark"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <UiInput
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={String(safeValue)}
        onChange={(event) => textHistory.onValueChange(event.target.value)}
        textHistory={textHistory}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            stepBy(1);
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            stepBy(-1);
          }
        }}
        className="!h-full !min-h-0 min-w-0 flex-1 rounded-none !border-0 !bg-transparent px-2 text-right"
      />
      <div className="flex w-7 shrink-0 flex-col border-l border-border-dark">
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="color-only"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            stepBy(1);
          }}
          className="!h-4 !w-7 !rounded-none !border-0 !p-0"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="color-only"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            stepBy(-1);
          }}
          className="!h-4 !w-7 !rounded-none !border-0 !p-0"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </UiIconButton>
      </div>
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
