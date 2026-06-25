import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types/I18nText';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import { getSocketColor, getSocketTintColor, modelPortId } from '@/features/canvas/domain/socketTypes';
import { NodeModelParamsControls } from './NodeModelParamsControls';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_ROW_CARD_CLASS,
  NODE_ROW_HOVER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';

interface ModelInputRowProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  /** 已连线的模型选择器解析出的覆盖模型 id；非空时节点内选择只读 */
  overrideModelId: string | null;
  storedParams: Record<string, unknown> | undefined;
  onModelChange: (modelId: string) => void;
  onParamsChange: (params: Record<string, unknown>) => void;
  incomingImages?: string[];
}

/**
 * 模型输入行：标签 + MODEL 端口 + 节点内模型选择。
 * 连上模型选择器节点后，节点内选择变为只读展示，实际生效模型以连线为准
 * （由调用方在计算 selectedModelId 时优先采用 overrideModelId）。
 */
export function ModelInputRow({
  mediaType,
  modelId,
  overrideModelId,
  storedParams,
  onModelChange,
  onParamsChange,
  incomingImages,
}: ModelInputRowProps) {
  const { t, i18n } = useTranslation();
  const socketColor = getSocketColor('MODEL');
  const overrideModel = useMemo(
    () => (overrideModelId ? registry.getModel(overrideModelId) : undefined),
    [overrideModelId]
  );

  return (
    <div
      className={`relative flex items-center justify-between gap-2 px-3 py-1.5 ${NODE_ROW_CARD_CLASS} ${
        overrideModelId ? '' : NODE_ROW_HOVER_CLASS
      }`}
      style={overrideModelId ? { backgroundColor: getSocketTintColor('MODEL') } : undefined}
    >
      <Handle
        type="target"
        id={modelPortId()}
        position={Position.Left}
        style={{ background: socketColor, left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
        className="!h-2.5 !w-2.5 !border !border-surface-dark"
      />
      <span className="shrink-0 text-xs text-text-muted">{t('node.modelRow.label')}</span>
      {overrideModelId ? (
        <span
          className="min-w-0 truncate text-xs text-text-dark"
          title={t('node.modelRow.linked')}
        >
          {overrideModel ? getI18nText(overrideModel.meta.name, i18n.language) : overrideModelId}
        </span>
      ) : (
        <NodeModelParamsControls
          mediaType={mediaType}
          modelId={modelId}
          storedParams={storedParams}
          onModelChange={onModelChange}
          onParamsChange={onParamsChange}
          incomingImages={incomingImages}
          chipClassName={NODE_CONTROL_CHIP_CLASS}
          modelChipClassName={`${NODE_CONTROL_MODEL_CHIP_CLASS} !h-7 !w-[180px]`}
          showParamsChip={false}
        />
      )}
    </div>
  );
}
