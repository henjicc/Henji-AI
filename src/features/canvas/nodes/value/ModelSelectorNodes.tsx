import { memo, useCallback, useState, type ReactNode } from 'react';
import { AudioLines, Maximize2, Minimize2, Sparkles, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT,
  MODEL_SELECTOR_EXPANDED_DEFAULT_HEIGHT,
  MODEL_SELECTOR_EXPANDED_DEFAULT_WIDTH,
  MODEL_SELECTOR_EXPANDED_MAX_HEIGHT,
  MODEL_SELECTOR_EXPANDED_MAX_WIDTH,
  MODEL_SELECTOR_EXPANDED_MIN_HEIGHT,
  MODEL_SELECTOR_EXPANDED_MIN_WIDTH,
  type ModelSelectorNodeData,
} from '@/features/canvas/domain/canvasNodes';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import { ModelPickerList } from '@/features/canvas/params/ModelPickerList';
import { NodeModelParamsControls } from '@/features/canvas/params/NodeModelParamsControls';
import { useModelPickerList } from '@/features/canvas/params/useModelPickerList';
import { NODE_CONTROL_CHIP_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { UiIconButton } from '@/components/ui';
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

function useToggleExpanded(id: string, isExpanded: boolean, collapsedWidth: number): () => void {
  const setModelSelectorExpanded = useCanvasStore((state) => state.setModelSelectorExpanded);
  return useCallback(
    () => setModelSelectorExpanded(id, !isExpanded, collapsedWidth),
    [id, isExpanded, collapsedWidth, setModelSelectorExpanded]
  );
}

/** 模型选择器节点的最小宽度需随当前选中模型的名称/供应商文本长度自适应，避免裁切或留白过多 */
function useModelChipMinWidth(): [number, (contentWidth: number) => void] {
  const [minWidth, setMinWidth] = useState(MODEL_SELECTOR_BASE_MIN_WIDTH);
  const handleContentWidthChange = useCallback((contentWidth: number) => {
    setMinWidth(Math.max(MODEL_SELECTOR_BASE_MIN_WIDTH, Math.ceil(contentWidth) + MODEL_CHIP_WIDTH_CHROME));
  }, []);
  return [minWidth, handleContentWidthChange];
}

function ExpandToggleButton({ isExpanded, onToggle }: { isExpanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <UiIconButton
      type="button"
      showBorder={false}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="nodrag !h-6 !w-6 !border-0 !bg-transparent !p-0 text-text-muted hover:!bg-transparent hover:!text-accent"
      title={isExpanded ? t('modelParams.collapse', { defaultValue: '收起' }) : t('modelParams.expand', { defaultValue: '展开' })}
    >
      {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
    </UiIconButton>
  );
}

function ModelSelectorCollapsedBody({
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

/** 展开态正文：搜索 + 供应商筛选 + 模型列表直接铺满节点，选中模型后不收起，方便连续切换对比 */
function ModelSelectorExpandedBody({
  id,
  data,
  mediaType,
}: {
  id: string;
  data: ModelSelectorNodeData;
  mediaType: CanvasModelMediaType;
}) {
  const setModelId = useSetModelId(id);
  const {
    modelSearchQuery,
    setModelSearchQuery,
    providerFilter,
    setProviderFilter,
    providerOptions,
    filteredModels,
    selectedModel,
  } = useModelPickerList({ mediaType, modelId: data.modelId });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <ModelPickerList
        variant="inline"
        modelSearchQuery={modelSearchQuery}
        onSearchChange={setModelSearchQuery}
        providerFilter={providerFilter}
        onProviderFilterChange={setProviderFilter}
        providerOptions={providerOptions}
        filteredModels={filteredModels}
        selectedModel={selectedModel}
        onModelChange={setModelId}
      />
    </div>
  );
}

function useExpandedSize(width: number | undefined, height: number | undefined) {
  return {
    width: Math.max(MODEL_SELECTOR_EXPANDED_MIN_WIDTH, width ?? MODEL_SELECTOR_EXPANDED_DEFAULT_WIDTH),
    height: Math.max(MODEL_SELECTOR_EXPANDED_MIN_HEIGHT, height ?? MODEL_SELECTOR_EXPANDED_DEFAULT_HEIGHT),
  };
}

function ModelSelectorNode({
  id,
  data,
  selected,
  width,
  height,
  nodeType,
  mediaType,
  icon,
}: ModelSelectorNodeProps & {
  nodeType: typeof CANVAS_NODE_TYPES.imageModelSelector
    | typeof CANVAS_NODE_TYPES.videoModelSelector
    | typeof CANVAS_NODE_TYPES.audioModelSelector;
  mediaType: CanvasModelMediaType;
  icon: ReactNode;
}) {
  const [collapsedMinWidth, handleContentWidthChange] = useModelChipMinWidth();
  const isExpanded = Boolean(data.isExpanded);
  const toggleExpanded = useToggleExpanded(id, isExpanded, collapsedMinWidth);
  const expandedSize = useExpandedSize(width, height);

  return (
    <ValueSourceShell
      id={id}
      nodeType={nodeType}
      data={data}
      socketType="MODEL"
      selected={selected}
      icon={icon}
      headerRightSlot={<ExpandToggleButton isExpanded={isExpanded} onToggle={toggleExpanded} />}
      width={isExpanded ? expandedSize.width : collapsedMinWidth}
      height={isExpanded ? expandedSize.height : MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT}
      minWidth={isExpanded ? MODEL_SELECTOR_EXPANDED_MIN_WIDTH : collapsedMinWidth}
      minHeight={isExpanded ? MODEL_SELECTOR_EXPANDED_MIN_HEIGHT : MODEL_SELECTOR_COLLAPSED_DEFAULT_HEIGHT}
      maxWidth={isExpanded ? MODEL_SELECTOR_EXPANDED_MAX_WIDTH : undefined}
      maxHeight={isExpanded ? MODEL_SELECTOR_EXPANDED_MAX_HEIGHT : undefined}
      resizable={isExpanded}
    >
      {isExpanded ? (
        <ModelSelectorExpandedBody id={id} data={data} mediaType={mediaType} />
      ) : (
        <ModelSelectorCollapsedBody
          id={id}
          data={data}
          mediaType={mediaType}
          onContentWidthChange={handleContentWidthChange}
        />
      )}
    </ValueSourceShell>
  );
}

export const ImageModelSelectorNode = memo((props: ModelSelectorNodeProps) => (
  <ModelSelectorNode
    {...props}
    nodeType={CANVAS_NODE_TYPES.imageModelSelector}
    mediaType="image"
    icon={<Sparkles className="h-4 w-4" />}
  />
));
ImageModelSelectorNode.displayName = 'ImageModelSelectorNode';

export const VideoModelSelectorNode = memo((props: ModelSelectorNodeProps) => (
  <ModelSelectorNode
    {...props}
    nodeType={CANVAS_NODE_TYPES.videoModelSelector}
    mediaType="video"
    icon={<Video className="h-4 w-4" />}
  />
));
VideoModelSelectorNode.displayName = 'VideoModelSelectorNode';

export const AudioModelSelectorNode = memo((props: ModelSelectorNodeProps) => (
  <ModelSelectorNode
    {...props}
    nodeType={CANVAS_NODE_TYPES.audioModelSelector}
    mediaType="audio"
    icon={<AudioLines className="h-4 w-4" />}
  />
));
AudioModelSelectorNode.displayName = 'AudioModelSelectorNode';
