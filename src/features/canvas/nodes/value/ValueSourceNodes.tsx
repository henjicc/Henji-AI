import { memo, useCallback } from 'react';
import { Hash, ToggleLeft, Type } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type ValueSourceNodeData } from '@/features/canvas/domain/canvasNodes';
import { UiInput, UiSwitch, UiTextArea } from '@/components/ui';
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
  return (
    <UiInput
      type="number"
      value={Number.isFinite(value) ? String(value) : '0'}
      onChange={(event) => {
        const parsed = integer
          ? Number.parseInt(event.target.value, 10)
          : Number.parseFloat(event.target.value);
        onCommit(Number.isFinite(parsed) ? parsed : 0);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="h-8 w-full"
    />
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
