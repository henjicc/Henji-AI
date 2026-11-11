import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ParamDef } from '@/core/types';
import { resolveInputLimits } from '@/core/inputs/inputLimits';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes';
import { useNodeHandlesSync } from '@/features/canvas/hooks/useNodeHandlesSync';
import { NODE_ROW_GAP_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { UiFieldLayoutContext } from '@/components/ui/fieldLayout';
import type { VideoTrimRange } from '@/components/videoTrim/VideoTrimModal';
import type { CanvasHistoryGroupOptions } from '@/stores/canvasStore';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import {
  resolveGenerationMediaInputConstraints,
} from '@/features/canvas/application/generationMediaInputConstraints';
import { MediaInputsRow, type MediaInputSource } from './MediaInputRow';
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
  /** 由宿主节点外缘承载的媒体端口。 */
  externalMediaHandle?: RowMediaKind;
  schema: ParamDef[];
  values: DynamicValueMap;
  setParam: (key: string, value: DynamicValue, options?: CanvasHistoryGroupOptions) => void;
  setParams: (changes: DynamicValueMap, options?: CanvasHistoryGroupOptions) => void;
  excludeParamIds?: string[];
  mediaInputs: Partial<Record<RowMediaKind, string[]>>;
  onMediaInputsChange: (changes: Partial<Record<RowMediaKind, string[]>>) => void;
  overrideModelId: string | null;
  onModelChange: (modelId: string) => void;
  incomingImages?: string[];
  /** 能力节点的模型白名单；省略时保持普通生成节点行为。 */
  modelPolicy?: CanvasImageCapabilityModelPolicy;
  /** 固定模型工具可以隐藏模型选择与模型端口。 */
  showModelInput?: boolean;
  /** 能力级媒体数量上限会与模型 inputLimits 取较小值。 */
  maxMediaCounts?: Partial<Record<RowMediaKind, number>>;
  /** 只呈现能力允许用户修改的 schema 参数；模型行和提示词不受此字段影响。 */
  visibleParamIds?: readonly string[];
  /** 视频媒体行已保存的裁剪选区（若有） */
  videoTrimRange?: VideoTrimRange | null;
  /** 确认裁剪只回传选区，不替换视频引用——完整视频始终保留 */
  onVideoTrimRangeChange?: (range: VideoTrimRange) => void;
}

/**
 * 节点逐行输入编排：模型行 → 参考素材行 → 标量参数行（参数顺序沿用各自 schema 的 order，
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
  externalMediaHandle,
  schema,
  values,
  setParam,
  setParams,
  excludeParamIds,
  mediaInputs,
  onMediaInputsChange,
  overrideModelId,
  onModelChange,
  incomingImages,
  modelPolicy,
  showModelInput = true,
  maxMediaCounts,
  visibleParamIds,
  videoTrimRange,
  onVideoTrimRangeChange,
}: NodeInputRowsProps) {
  const { t } = useTranslation();
  const limits = useMemo(() => resolveInputLimits(modelId, values), [modelId, values]);
  const mediaConstraints = useMemo(
    () => resolveGenerationMediaInputConstraints(schema, excludeParamIds),
    [excludeParamIds, schema],
  );

  const mediaRows = useMemo(
    () => MEDIA_ROW_ORDER
      .filter((kind) => acceptedMediaKinds.includes(kind))
      .map((kind) => ({
        kind,
        max: Math.min(
          limits[MEDIA_LIMIT_KEY[kind]].max,
          maxMediaCounts?.[kind] ?? Number.POSITIVE_INFINITY,
        ),
        constraint: mediaConstraints[kind],
      }))
      .filter((row) => row.max > 0)
      // 单张原图已由工作面展示，参数区不重复呈现；空输入与多图仍保留媒体行。
      .filter((row) => !(row.kind === 'image' && externalMediaHandle === 'image'
        && row.max === 1 && incomingImages?.length === 1)),
    [acceptedMediaKinds, limits, maxMediaCounts, mediaConstraints, externalMediaHandle, incomingImages?.length]
  );

  const visibleSchema = useMemo(
    () => visibleParamIds
      ? schema.filter((param) => visibleParamIds.includes(param.id))
      : schema,
    [schema, visibleParamIds],
  );

  const mediaSources: MediaInputSource[] = mediaRows.map(({ kind, max, constraint }) => ({
    kind,
    maxCount: max,
    inlineValue: mediaInputs[kind] ?? [],
    onInlineChange: (next) => onMediaInputsChange({ [kind]: next }),
    acceptedFileTypes: constraint?.accept,
    maxFileSizeBytes: constraint?.maxSizeBytes,
    videoTrimMaxClipSeconds: kind === 'video' ? limits.videoConstraints?.trim?.maxClipSeconds : undefined,
    videoTrimMaxSizeMB: kind === 'video' ? limits.videoConstraints?.maxSizeMB : undefined,
    videoTrimRange: kind === 'video' ? videoTrimRange : undefined,
    onVideoTrimRangeChange: kind === 'video' ? onVideoTrimRangeChange : undefined,
  }));

  // 素材类型随模型/模式联动增减（如切到"参考生视频"多收视频），端口集合随之变化
  useNodeHandlesSync(nodeId, `${showModelInput ? 'model' : 'fixed'}|${mediaRows.map((row) => row.kind).join('|')}|${externalMediaHandle ?? ''}`);

  return (
    // 行内取值控件按工具条排布：下拉、面板、数值统一成静默触发器（值 + 下箭头，悬停出底）
    <UiFieldLayoutContext.Provider value="toolbar">
    <div className={`flex flex-col ${NODE_ROW_GAP_CLASS} ${className}`}>
      {showModelInput && (
        <ModelInputRow
          mediaType={mediaType}
          modelId={modelId}
          overrideModelId={overrideModelId}
          onModelChange={onModelChange}
          modelPolicy={modelPolicy}
        />
      )}

      {/* 图片、视频、音频合成一行，所有节点一律叫“参考素材”：一个端口、一个上传入口，进来后仍按类型分开存放与编号 */}
      {mediaSources.length > 0 && (
        <MediaInputsRow
          nodeId={nodeId}
          label={t('node.mediaRow.reference')}
          sources={mediaSources}
          onSourcesChange={onMediaInputsChange}
          handleKinds={mediaSources.map((source) => source.kind).filter((kind) => kind !== externalMediaHandle)}
        />
      )}

      <NodeParamRows
        dividerAbove={showModelInput || mediaRows.length > 0}
        nodeId={nodeId}
        modelId={modelId}
        schema={visibleSchema}
        values={values}
        setParam={setParam}
        setParams={setParams}
        excludeParamIds={excludeParamIds}
      />
    </div>
    </UiFieldLayoutContext.Provider>
  );
}
