import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import { registry } from '@/core/ModelRegistry';
import type { ParamDef } from '@/core/types';
import { deriveSocketType, getSocketColor } from '@/core/types/SocketType';
import { getI18nText } from '@/core/types/I18nText';
import { ParamGroupTrigger } from '@/components/params/ParamGroupTrigger';
import { isParamDisabled } from '@/components/params/paramVisibility';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  areStringSetsEqual,
  areValueOverridesEqual,
  collectInputValues,
  getConnectedParamIds,
  resolveVisibleSchemaParamRows,
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
import type { CanvasHistoryGroupOptions } from '@/stores/canvasStore';
import { createCanvasTextHistoryGroup } from '@/features/canvas/hooks/useCanvasTextHistory';
import { ParamLabel } from '@/components/params/ParamLabel';

interface NodeParamRowsProps {
  /** 节点 id（用于读取连到本节点参数端口的上游值） */
  nodeId: string;
  /** 当前模型 id（读取参数展示分组与联动规则） */
  modelId: string;
  /** 模型参数 schema（registry.getSchema 结果） */
  schema: ParamDef[];
  /** 默认值与持久化合并后的当前参数值 */
  values: DynamicValueMap;
  /** 参数变化回写 */
  setParam: (key: string, value: DynamicValue, options?: CanvasHistoryGroupOptions) => void;
  setParams: (changes: DynamicValueMap, options?: CanvasHistoryGroupOptions) => void;
  /** 不在逐行区渲染的参数（如 prompt，由 shell 单独渲染） */
  excludeParamIds?: string[];
}

/**
 * 标准逐行参数渲染：每个普通参数一行（标签居左、紧凑控件居右），
 * 行外壳为统一卡片样式（NODE_ROW_CARD_CLASS），左侧端口圆点贴齐行容器边缘。
 *
 * - 端口未连线：内联编辑（NodeParamControl，复用底层 primitive）
 * - 端口已连线：控件进入只读态，卡片底色换成插槽颜色提示（widget ↔ input 双态）
 * - 展示组：始终通过 ParamGroupTrigger 浮层编辑；仅保留已连线参数行以兼容旧画布
 * - 可见性沿用 isParamVisible；行为差异全部由 schema 驱动，无模型/节点特判
 */
export const NodeParamRows = memo(({
  nodeId,
  modelId,
  schema,
  values,
  setParam,
  setParams,
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

  const modelDef = useMemo(() => registry.getModel(modelId), [modelId]);
  const rowPlan = useMemo(
    () => resolveVisibleSchemaParamRows(modelDef, schema, mergedValues, excluded, connectedParamIds),
    [connectedParamIds, excluded, mergedValues, modelDef, schema],
  );
  const { linkageEngine, presentationItems } = rowPlan;
  const displayedParamIds = useMemo(
    () => rowPlan.displayedParams.map((param) => param.id),
    [rowPlan.displayedParams],
  );

  // 参数行随联动 hide/show 增减，端口纵向位置会整体位移
  useNodeHandlesSync(nodeId, displayedParamIds.join('|'));

  const renderParamRow = (param: ParamDef) => {
    const isConnected = connectedParamIds.has(param.id);
    const socketType = deriveSocketType(param);
    const socketColor = getSocketColor(socketType);
    const textHistoryGroup = createCanvasTextHistoryGroup(nodeId, `params.${param.id}`);
    const textHistoryOptions = param.type === 'text' || param.type === 'textarea'
      ? { historyGroup: textHistoryGroup }
      : undefined;
    return (
      <div
        key={param.id}
        className={`${NODE_ROW_CLASS} ${isConnected ? '' : NODE_ROW_HOVER_CLASS}`}
      >
        <Handle
          type="target"
          id={paramPortId(param.id)}
          position={Position.Left}
          style={{ background: socketColor, left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
          className={`${NODE_PORT_ROW_CLASS} ${isConnected ? NODE_PORT_VISIBLE_CLASS : ''}`}
        />
        <ParamLabel
          param={param}
          language={i18n.language}
          className={`${NODE_ROW_LABEL_CLASS} !mb-0`}
        />
        <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
          <NodeParamControl
            param={param}
            value={mergedValues[param.id]}
            onChange={(next) => setParam(param.id, next, textHistoryOptions)}
            allValues={mergedValues}
            onParamChange={setParam}
            onParamChanges={setParams}
            historyGroup={textHistoryGroup}
            disabled={isConnected || isParamDisabled(param, mergedValues, linkageEngine)}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      {presentationItems.flatMap((item) => {
        if (item.kind === 'param') return [renderParamRow(item.param)];

        // 已连线端口必须继续留在节点 DOM 中；未连线的组内参数只在浮层中编辑。
        const inlineParams = item.params.filter((param) => connectedParamIds.has(param.id));
        const groupName = getI18nText(item.group.name, i18n.language) || item.group.id;
        return [
          <div key={`group:${item.group.id}`} className={`${NODE_ROW_CLASS} ${NODE_ROW_HOVER_CLASS}`}>
            <span className={NODE_ROW_LABEL_CLASS}>{groupName}</span>
            <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
              <ParamGroupTrigger
                group={item.group}
                params={item.params}
                values={mergedValues}
                onChange={(paramId, next) => {
                  const param = item.params.find((candidate) => candidate.id === paramId);
                  const options = param?.type === 'text' || param?.type === 'textarea'
                    ? { historyGroup: createCanvasTextHistoryGroup(nodeId, `params.${paramId}`) }
                    : undefined;
                  setParam(paramId, next, options);
                }}
                onChanges={setParams}
                linkageEngine={linkageEngine}
                disabledParamIds={connectedParamIds}
                compact
              />
            </div>
          </div>,
          ...inlineParams.map(renderParamRow),
        ];
      })}
    </>
  );
});

NodeParamRows.displayName = 'NodeParamRows';
