import { memo, useCallback, useState } from 'react';
import { AudioLines, Sparkles, Video } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { CANVAS_NODE_TYPES, type ModelSelectorNodeData } from '@/features/canvas/domain/canvasNodes';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import { NodeModelParamsControls } from '@/features/canvas/params/NodeModelParamsControls';
import { NODE_CONTROL_CHIP_CLASS } from '@/features/canvas/ui/nodeControlStyles';
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

// 节点壳体内边距 + chip 自身的内边距/边框，叠加在模型 chip 内容实测宽度之上，得到不裁切内容所需的最小宽度
const MODEL_CHIP_WIDTH_CHROME = 64;
const MODEL_SELECTOR_BASE_MIN_WIDTH = 160;
// 独立模型选择器节点中 chip 是唯一子项，铺满整行即可，不需要像行内用法那样限制最大宽度
const MODEL_SELECTOR_CHIP_CLASS = '!w-full !min-w-0 !justify-start';

function useSetModelId(id: string): (modelId: string) => void {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  return useCallback((modelId: string) => updateNodeData(id, { modelId }), [id, updateNodeData]);
}

/** 模型选择器节点的最小宽度需随当前选中模型的名称/供应商文本长度自适应，避免裁切或留白过多 */
function useModelChipMinWidth(): [number, (contentWidth: number) => void] {
  const [minWidth, setMinWidth] = useState(MODEL_SELECTOR_BASE_MIN_WIDTH);
  const handleContentWidthChange = useCallback((contentWidth: number) => {
    setMinWidth(Math.max(MODEL_SELECTOR_BASE_MIN_WIDTH, Math.ceil(contentWidth) + MODEL_CHIP_WIDTH_CHROME));
  }, []);
  return [minWidth, handleContentWidthChange];
}

function ModelSelectorBody({
  id,
  data,
  mediaType,
  onContentWidthChange,
}: {
  id: string;
  data: ModelSelectorNodeData;
  mediaType: CanvasModelMediaType;
  onContentWidthChange: (width: number) => void;
}) {
  const setModelId = useSetModelId(id);
  return (
    <NodeModelParamsControls
      mediaType={mediaType}
      modelId={data.modelId}
      storedParams={undefined}
      onModelChange={setModelId}
      onParamsChange={NOOP_PARAMS_CHANGE}
      chipClassName={NODE_CONTROL_CHIP_CLASS}
      modelChipClassName={MODEL_SELECTOR_CHIP_CLASS}
      showParamsChip={false}
      onModelChipContentWidthChange={onContentWidthChange}
    />
  );
}

export const ImageModelSelectorNode = memo(({ id, data, selected, width, height }: ModelSelectorNodeProps) => {
  const [minWidth, handleContentWidthChange] = useModelChipMinWidth();
  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.imageModelSelector}
      data={data}
      socketType="MODEL"
      selected={selected}
      width={width ?? 240}
      height={height}
      minWidth={minWidth}
      minHeight={56}
      icon={<Sparkles className="h-4 w-4" />}
    >
      <ModelSelectorBody id={id} data={data} mediaType="image" onContentWidthChange={handleContentWidthChange} />
    </ValueSourceShell>
  );
});
ImageModelSelectorNode.displayName = 'ImageModelSelectorNode';

export const VideoModelSelectorNode = memo(({ id, data, selected, width, height }: ModelSelectorNodeProps) => {
  const [minWidth, handleContentWidthChange] = useModelChipMinWidth();
  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.videoModelSelector}
      data={data}
      socketType="MODEL"
      selected={selected}
      width={width ?? 240}
      height={height}
      minWidth={minWidth}
      minHeight={56}
      icon={<Video className="h-4 w-4" />}
    >
      <ModelSelectorBody id={id} data={data} mediaType="video" onContentWidthChange={handleContentWidthChange} />
    </ValueSourceShell>
  );
});
VideoModelSelectorNode.displayName = 'VideoModelSelectorNode';

export const AudioModelSelectorNode = memo(({ id, data, selected, width, height }: ModelSelectorNodeProps) => {
  const [minWidth, handleContentWidthChange] = useModelChipMinWidth();
  return (
    <ValueSourceShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.audioModelSelector}
      data={data}
      socketType="MODEL"
      selected={selected}
      width={width ?? 240}
      height={height}
      minWidth={minWidth}
      minHeight={56}
      icon={<AudioLines className="h-4 w-4" />}
    >
      <ModelSelectorBody id={id} data={data} mediaType="audio" onContentWidthChange={handleContentWidthChange} />
    </ValueSourceShell>
  );
});
AudioModelSelectorNode.displayName = 'AudioModelSelectorNode';
