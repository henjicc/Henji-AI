import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ParamDef } from '@/core/types';
import { resolveInputLimits } from '@/core/inputs/inputLimits';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes';
import { useNodeHandlesSync } from '@/features/canvas/hooks/useNodeHandlesSync';
import { NODE_ROW_GAP_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import type { VideoTrimRange } from '@/components/videoTrim/VideoTrimModal';
import type { CanvasHistoryGroupOptions } from '@/stores/canvasStore';
import { MediaInputRow } from './MediaInputRow';
import { ModelInputRow } from './ModelInputRow';
import { NodeParamRows } from './NodeParamRows';

const MEDIA_ROW_ORDER: RowMediaKind[] = ['image', 'video', 'audio'];
const MEDIA_LIMIT_KEY: Record<RowMediaKind, 'images' | 'videos' | 'audios'> = {
  image: 'images',
  video: 'videos',
  audio: 'audios',
};

interface NodeInputRowsProps {
  /** 由宿主节点控制该区域在纵向布局中的伸缩行为（如拉高时保持不变形的 shrink-0） */
  className?: string;
  nodeId: string;
  modelId: string;
  mediaType: CanvasModelMediaType;
  /** 该节点声明可接受的媒体类型（来自 ports.target.accepts，已过滤为 image/video/audio） */
  acceptedMediaKinds: RowMediaKind[];
  schema: ParamDef[];
  values: DynamicValueMap;
  setParam: (key: string, value: DynamicValue, options?: CanvasHistoryGroupOptions) => void;
  excludeParamIds?: string[];
  mediaInputs: Partial<Record<RowMediaKind, string[]>>;
  onMediaInputChange: (kind: RowMediaKind, next: string[]) => void;
  overrideModelId: string | null;
  storedParams: DynamicValueMap | undefined;
  onModelChange: (modelId: string) => void;
  onParamsChange: (params: DynamicValueMap) => void;
  incomingImages?: string[];
  /** 视频媒体行已保存的裁剪选区（若有） */
  videoTrimRange?: VideoTrimRange | null;
  /** 确认裁剪只回传选区，不替换视频引用——完整视频始终保留 */
  onVideoTrimRangeChange?: (range: VideoTrimRange) => void;
}

/**
 * 节点逐行输入编排：模型行 → 媒体行 → 标量参数行（参数顺序沿用各自 schema 的 order，
 * "模式"一类的首要参数通常 order 较小，紧随模型行之后自然呈现）。
 * 提示词不在此渲染（由 GenerationNodeShell 的大输入框单独承载，仅暴露一个端口）。
 * 行的可见性与顺序完全由节点声明（accepts/schema）与模型 inputLimits 推导，无节点类型特判。
 */
export function NodeInputRows({
  className = '',
  nodeId,
  modelId,
  mediaType,
  acceptedMediaKinds,
  schema,
  values,
  setParam,
  excludeParamIds,
  mediaInputs,
  onMediaInputChange,
  overrideModelId,
  storedParams,
  onModelChange,
  onParamsChange,
  incomingImages,
  videoTrimRange,
  onVideoTrimRangeChange,
}: NodeInputRowsProps) {
  const { t } = useTranslation();
  const limits = useMemo(() => resolveInputLimits(modelId, values), [modelId, values]);

  const mediaRows = useMemo(
    () => MEDIA_ROW_ORDER
      .filter((kind) => acceptedMediaKinds.includes(kind))
      .map((kind) => ({ kind, max: limits[MEDIA_LIMIT_KEY[kind]].max }))
      .filter((row) => row.max > 0),
    [acceptedMediaKinds, limits]
  );

  // 媒体行随模型/模式联动增减（如切到"参考生视频"多出视频行），端口位置随之下移
  useNodeHandlesSync(nodeId, mediaRows.map((row) => row.kind).join('|'));

  return (
    <div className={`flex flex-col ${NODE_ROW_GAP_CLASS} ${className}`}>
      <ModelInputRow
        mediaType={mediaType}
        modelId={modelId}
        overrideModelId={overrideModelId}
        storedParams={storedParams}
        onModelChange={onModelChange}
        onParamsChange={onParamsChange}
        incomingImages={incomingImages}
      />

      {mediaRows.map(({ kind, max }) => (
        <MediaInputRow
          key={kind}
          nodeId={nodeId}
          mediaKind={kind}
          label={t(`node.mediaRow.${kind}`)}
          maxCount={max}
          inlineValue={mediaInputs[kind] ?? []}
          onInlineChange={(next) => onMediaInputChange(kind, next)}
          videoTrimMaxClipSeconds={kind === 'video' ? limits.videoConstraints?.trim?.maxClipSeconds : undefined}
          videoTrimMaxSizeMB={kind === 'video' ? limits.videoConstraints?.maxSizeMB : undefined}
          videoTrimRange={kind === 'video' ? videoTrimRange : undefined}
          onVideoTrimRangeChange={kind === 'video' ? onVideoTrimRangeChange : undefined}
        />
      ))}

      <NodeParamRows
        nodeId={nodeId}
        schema={schema}
        values={values}
        setParam={setParam}
        excludeParamIds={excludeParamIds}
      />
    </div>
  );
}
