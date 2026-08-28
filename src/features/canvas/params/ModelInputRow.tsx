import { useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types/I18nText';
import type { ModelTag } from '@/core/types';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import { getSocketColor, modelPortId } from '@/features/canvas/domain/socketTypes';
import { NodeModelParamsControls } from './NodeModelParamsControls';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_HOVER_CLASS,
  NODE_ROW_LABEL_CLASS,
  NODE_PORT_ROW_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';

interface ModelInputRowProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  /** 已连线的模型选择器解析出的覆盖模型 id；非空时节点内选择只读 */
  overrideModelId: string | null;
  storedParams: DynamicValueMap | undefined;
  onModelChange: (modelId: string) => void;
  onParamsChange: (params: DynamicValueMap) => void;
  incomingImages?: string[];
  /** 限定可选模型必须同时具备的标签（如仅展示支持图片编辑的模型） */
  requiredTags?: ModelTag[];
  /** 可选的能力级模型约束；省略时保持历史模型列表行为 */
  modelPolicy?: CanvasImageCapabilityModelPolicy;
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
  requiredTags,
  modelPolicy,
}: ModelInputRowProps) {
  const { t, i18n } = useTranslation();
  const socketColor = getSocketColor('MODEL');
  const overrideModel = useMemo(
    () => (overrideModelId ? registry.getModel(overrideModelId) : undefined),
    [overrideModelId]
  );

  return (
    <div
      className={`${NODE_ROW_CLASS} ${
        overrideModelId ? '' : NODE_ROW_HOVER_CLASS
      }`}
    >
      <Handle
        type="target"
        id={modelPortId()}
        position={Position.Left}
        style={{ background: socketColor, left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
        className={`${NODE_PORT_ROW_CLASS} ${overrideModelId ? NODE_PORT_VISIBLE_CLASS : ''}`}
      />
      <span className={NODE_ROW_LABEL_CLASS}>{t('node.modelRow.label')}</span>
      <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
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
            requiredTags={requiredTags}
            modelPolicy={modelPolicy}
            chipClassName={NODE_CONTROL_CHIP_CLASS}
            modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
            showParamsChip={false}
          />
        )}
      </div>
    </div>
  );
}
