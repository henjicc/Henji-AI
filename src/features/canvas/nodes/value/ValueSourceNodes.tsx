import { memo, useCallback } from 'react';
import { ChevronDown, ChevronUp, Hash, ToggleLeft, Type } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type ValueSourceNodeData } from '@/features/canvas/domain/canvasNodes';
import { UiIconButton, UiInput, UiSwitch, UiTextArea } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { ValueSourceShell } from './ValueSourceShell';

type ValueNodeProps = NodeProps & {
  id: string;
  data: ValueSourceNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

function useSetValue(id: string): (value: number | string | boolean) => void {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  return useCallback(
    (value: number | string | boolean) => updateNodeData(id, { value }),
    [id, updateNodeData]
  );
}

function NumberValueField({
  value,
  integer,
  onCommit,
}: {
  value: number;
  integer: boolean;
  onCommit: (value: number) => void;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const commit = useCallback((raw: number) => {
    const next = integer ? Math.round(raw) : raw;
    onCommit(Number.isFinite(next) ? next : 0);
  }, [integer, onCommit]);
  const stepBy = useCallback((direction: 1 | -1) => {
    commit(safeValue + direction * (integer ? 1 : 0.1));
  }, [commit, integer, safeValue]);

  return (
    <div
      className="nodrag nowheel flex h-8 w-full overflow-hidden rounded-md border border-border-dark bg-surface-dark"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <UiInput
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={String(safeValue)}
        onChange={(event) => {
          const parsed = integer
            ? Number.parseInt(event.target.value, 10)
            : Number.parseFloat(event.target.value);
          commit(parsed);
        }}
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
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            stepBy(1);
          }}
          className="!h-4 !w-7 !rounded-none !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-layer hover:!text-text-dark"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton
          type="button"
          showBorder={false}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            stepBy(-1);
          }}
          className="!h-4 !w-7 !rounded-none !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-layer hover:!text-text-dark"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </UiIconButton>
      </div>
    </div>
  );
}

export const IntSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const setValue = useSetValue(id);
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
      icon={<Hash className="h-4 w-4" />}
    >
      <NumberValueField value={Number(data.value)} integer onCommit={setValue} />
    </ValueSourceShell>
  );
});
IntSourceNode.displayName = 'IntSourceNode';

export const FloatSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const setValue = useSetValue(id);
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
      icon={<Hash className="h-4 w-4" />}
    >
      <NumberValueField value={Number(data.value)} integer={false} onCommit={setValue} />
    </ValueSourceShell>
  );
});
FloatSourceNode.displayName = 'FloatSourceNode';

export const StringSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const setValue = useSetValue(id);
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
      icon={<Type className="h-4 w-4" />}
    >
      <UiTextArea
        value={typeof data.value === 'string' ? data.value : ''}
        onChange={(event) => setValue(event.target.value)}
        onMouseDown={(event) => event.stopPropagation()}
        className="ui-scrollbar min-h-0 flex-1 resize-none"
      />
    </ValueSourceShell>
  );
});
StringSourceNode.displayName = 'StringSourceNode';

export const BooleanSourceNode = memo(({ id, data, selected, width, height }: ValueNodeProps) => {
  const setValue = useSetValue(id);
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
      icon={<ToggleLeft className="h-4 w-4" />}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{String(Boolean(data.value))}</span>
        <UiSwitch checked={Boolean(data.value)} onCheckedChange={setValue} />
      </div>
    </ValueSourceShell>
  );
});
BooleanSourceNode.displayName = 'BooleanSourceNode';
