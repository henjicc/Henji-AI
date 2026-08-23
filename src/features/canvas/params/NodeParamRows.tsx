import { memo, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import { registry } from '@/core/ModelRegistry';
import { LinkageEngine } from '@/core/linkage';
import type { ParamDef } from '@/core/types';
import { deriveSocketType, getSocketColor } from '@/core/types/SocketType';
import { getI18nText } from '@/core/types/I18nText';
import { buildParamPresentationItems } from '@/core/params/paramPresentation';
import { ParamGroupTrigger } from '@/components/params/ParamGroupTrigger';
import { isParamDisabled, isParamVisible } from '@/components/params/paramVisibility';
import { UiIconButton } from '@/components/ui';
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
import type { CanvasHistoryGroupOptions } from '@/stores/canvasStore';
import { createCanvasTextHistoryGroup } from '@/features/canvas/hooks/useCanvasTextHistory';

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
  modelId,
  schema,
  values,
  setParam,
  excludeParamIds,
}: NodeParamRowsProps) => {
  const { i18n } = useTranslation();
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
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
  const linkageEngine = useMemo(() => (
    modelDef?.linkages?.length ? new LinkageEngine(modelDef.linkages) : null
  ), [modelDef]);

  const visibleParams = useMemo(
    () =>
      [...schema]
        .filter((param) => !excluded.has(param.id))
        .filter((param) => isParamVisible(param, mergedValues, linkageEngine))
        .map((param): ParamDef => {
          if (!linkageEngine || (param.type !== 'dropdown' && param.type !== 'radio')) {
            return param;
          }
          const options = linkageEngine.getFilteredOptions(param.id, mergedValues, schema);
          if (!options.length || options === param.options) {
            return param;
          }
          return { ...param, options } as ParamDef;
        })
        .sort((a, b) => a.order - b.order),
    [schema, excluded, linkageEngine, mergedValues]
  );

  const presentationItems = useMemo(
    () => buildParamPresentationItems(visibleParams, modelDef?.paramPresentation),
    [modelDef?.paramPresentation, visibleParams]
  );

  const displayedParamIds = useMemo(
    () => presentationItems.flatMap((item) => {
      if (item.kind === 'param') return [item.param.id];
      if (expandedGroupIds.has(item.group.id)) return item.params.map((param) => param.id);
      return item.params
        .filter((param) => connectedParamIds.has(param.id))
        .map((param) => param.id);
    }),
    [connectedParamIds, expandedGroupIds, presentationItems]
  );

  // 参数行随联动 hide/show 增减，端口纵向位置会整体位移
  useNodeHandlesSync(nodeId, displayedParamIds.join('|'));

  const renderParamRow = (param: ParamDef) => {
    const isConnected = connectedParamIds.has(param.id);
    const socketType = deriveSocketType(param);
    const socketColor = getSocketColor(socketType);
    const label = getI18nText(param.name, i18n.language) || param.id;
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
        <span className={NODE_ROW_LABEL_CLASS}>{label}</span>
        <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
          <NodeParamControl
            param={param}
            value={mergedValues[param.id]}
            onChange={(next) => setParam(param.id, next, textHistoryOptions)}
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

        const expanded = expandedGroupIds.has(item.group.id);
        const inlineParams = expanded
          ? item.params
          : item.params.filter((param) => connectedParamIds.has(param.id));
        const groupName = getI18nText(item.group.name, i18n.language) || item.group.id;
        return [
          <div key={`group:${item.group.id}`} className={`${NODE_ROW_CLASS} ${NODE_ROW_HOVER_CLASS}`}>
            <span className={NODE_ROW_LABEL_CLASS}>{groupName}</span>
            <div className={`${NODE_ROW_CONTROL_SLOT_CLASS} gap-1`}>
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
                linkageEngine={linkageEngine}
                disabledParamIds={connectedParamIds}
                compact
              />
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                className="!h-7 !w-7 shrink-0"
                title={expanded ? '收起可连接参数' : '展开可连接参数'}
                aria-label={expanded ? '收起可连接参数' : '展开可连接参数'}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedGroupIds((current) => {
                    const next = new Set(current);
                    if (next.has(item.group.id)) next.delete(item.group.id);
                    else next.add(item.group.id);
                    return next;
                  });
                }}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
              </UiIconButton>
            </div>
          </div>,
          ...inlineParams.map(renderParamRow),
        ];
      })}
    </>
  );
});

NodeParamRows.displayName = 'NodeParamRows';
