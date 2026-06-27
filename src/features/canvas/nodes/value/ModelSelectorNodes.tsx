import { memo, useCallback } from 'react';
import { AudioLines, Sparkles, Video } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type ModelSelectorNodeData } from '@/features/canvas/domain/canvasNodes';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import { NodeModelParamsControls } from '@/features/canvas/params/NodeModelParamsControls';
import { NODE_CONTROL_CHIP_CLASS, NODE_CONTROL_MODEL_CHIP_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { useCanvasStore } from '@/stores/canvasStore';
import { ValueSourceShell } from './ValueSourceShell';

type ModelSelectorNodeProps = NodeProps & {
  id: string;
  data: ModelSelectorNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const NOOP_PARAMS_CHANGE = (): void => {};

function useSetModelId(id: string): (modelId: string) => void {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  return useCallback((modelId: string) => updateNodeData(id, { modelId }), [id, updateNodeData]);
}

function ModelSelectorBody({
  id,
  data,
  mediaType,
}: { id: string; data: ModelSelectorNodeData; mediaType: CanvasModelMediaType }) {
  const setModelId = useSetModelId(id);
  return (
    <NodeModelParamsControls
      mediaType={mediaType}
      modelId={data.modelId}
      storedParams={undefined}
      onModelChange={setModelId}
      onParamsChange={NOOP_PARAMS_CHANGE}
      chipClassName={NODE_CONTROL_CHIP_CLASS}
      modelChipClassName={`${NODE_CONTROL_MODEL_CHIP_CLASS} !w-[200px]`}
      showParamsChip={false}
    />
  );
}

export const ImageModelSelectorNode = memo(({ id, data, selected, width, height }: ModelSelectorNodeProps) => (
  <ValueSourceShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.imageModelSelector}
    data={data}
    socketType="MODEL"
    selected={selected}
    width={width ?? 240}
    height={height}
    icon={<Sparkles className="h-4 w-4" />}
  >
    <ModelSelectorBody id={id} data={data} mediaType="image" />
  </ValueSourceShell>
));
ImageModelSelectorNode.displayName = 'ImageModelSelectorNode';

export const VideoModelSelectorNode = memo(({ id, data, selected, width, height }: ModelSelectorNodeProps) => (
  <ValueSourceShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.videoModelSelector}
    data={data}
    socketType="MODEL"
    selected={selected}
    width={width ?? 240}
    height={height}
    icon={<Video className="h-4 w-4" />}
  >
    <ModelSelectorBody id={id} data={data} mediaType="video" />
  </ValueSourceShell>
));
VideoModelSelectorNode.displayName = 'VideoModelSelectorNode';

export const AudioModelSelectorNode = memo(({ id, data, selected, width, height }: ModelSelectorNodeProps) => (
  <ValueSourceShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.audioModelSelector}
    data={data}
    socketType="MODEL"
    selected={selected}
    width={width ?? 240}
    height={height}
    icon={<AudioLines className="h-4 w-4" />}
  >
    <ModelSelectorBody id={id} data={data} mediaType="audio" />
  </ValueSourceShell>
));
AudioModelSelectorNode.displayName = 'AudioModelSelectorNode';
