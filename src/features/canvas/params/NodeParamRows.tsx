import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import type { ParamDef } from '@/core/types';
import { deriveSocketType, getSocketColor } from '@/core/types/SocketType';
import { getI18nText } from '@/core/types/I18nText';
import { isParamVisible } from '@/components/params/paramVisibility';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  areStringSetsEqual,
  areValueOverridesEqual,
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver';
import { paramPortId } from '@/features/canvas/domain/socketTypes';
import { useNodeHandlesSync } from '@/features/canvas/hooks/useNodeHandlesSync';
import {
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_HOVER_CLASS,
  NODE_ROW_LABEL_CLASS,
  NODE_PORT_ROW_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { NodeParamControl } from './NodeParamControl';

interface NodeParamRowsProps {
  /** 节点 id（用于读取连到本节点参数端口的上游值） */
  nodeId: string;
  /** 模型参数 schema（registry.getSchema 结果） */
  schema: ParamDef[];
  /** 默认值与持久化合并后的当前参数值 */
  values: DynamicValueMap;
  /** 参数变化回写 */
  setParam: (key: string, value: DynamicValue) => void;
  /** 不在逐行区渲染的参数（如 prompt，由 shell 单独渲染） */
  excludeParamIds?: string[];
}

/**
 * ComfyUI 风格逐行参数渲染：每个参数一行（标签居左、紧凑控件居右），
 * 行外壳为统一卡片样式（NODE_ROW_CARD_CLASS），左侧端口圆点贴齐行容器边缘。
 *
 * - 端口未连线：内联编辑（NodeParamControl，复用底层 primitive）
 * - 端口已连线：控件进入只读态，卡片底色换成插槽颜色提示（widget ↔ input 双态）
 * - 可见性沿用 isParamVisible；行为差异全部由 schema 驱动，无模型/节点特判
 */
export const NodeParamRows = memo(({
  nodeId,
  schema,
  values,
  setParam,
  excludeParamIds,
}: NodeParamRowsProps) => {
  const { i18n } = useTranslation();
  const connectedParamIds = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => getConnectedParamIds(nodeId, state.edges),
    areStringSetsEqual
  );
  const connectedValues = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputValues(nodeId, state.nodes, state.edges),
    areValueOverridesEqual
  );

  const excluded = useMemo(
    () => new Set(excludeParamIds ?? []),
    [excludeParamIds]
  );

  // 连线注入值覆盖内联值，供控件显示与可见性判断
  const mergedValues = useMemo(
    () => ({ ...values, ...connectedValues }),
    [values, connectedValues]
  );

  const visibleParams = useMemo(
    () =>
      [...schema]
        .filter((param) => !excluded.has(param.id))
        .filter((param) => isParamVisible(param, mergedValues, null))
        .sort((a, b) => a.order - b.order),
    [schema, excluded, mergedValues]
  );

  // 参数行随联动 hide/show 增减，端口纵向位置会整体位移
  useNodeHandlesSync(nodeId, visibleParams.map((param) => param.id).join('|'));

  return (
    <>
      {visibleParams.map((param) => {
        const isConnected = connectedParamIds.has(param.id);
        const socketType = deriveSocketType(param);
        const socketColor = getSocketColor(socketType);
        const label = getI18nText(param.name, i18n.language) || param.id;
        return (
          <div
            key={param.id}
            className={`${NODE_ROW_CLASS} ${
              isConnected ? '' : NODE_ROW_HOVER_CLASS
            }`}
          >
            <Handle
              type="target"
              id={paramPortId(param.id)}
              position={Position.Left}
              style={{ background: socketColor, left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
              className={`${NODE_PORT_ROW_CLASS} ${isConnected ? NODE_PORT_VISIBLE_CLASS : ''}`}
            />
            <span className={NODE_ROW_LABEL_CLASS}>{label}</span>
            <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
              <NodeParamControl
                param={param}
                value={mergedValues[param.id]}
                onChange={(next) => setParam(param.id, next)}
                disabled={isConnected}
              />
            </div>
          </div>
        );
      })}
    </>
  );
});

NodeParamRows.displayName = 'NodeParamRows';
