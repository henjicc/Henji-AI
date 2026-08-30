import {
  type CanvasNodeData,
  type CanvasNodeType,
} from './canvasNodes';
import { canvasNodeDefinitions } from './nodeRegistryBuiltins';
import type { CanvasNodeDefinition } from './nodeRegistryContracts';
import {
  arePortsCompatible,
  getSourcePortMediaKind,
  type MediaPortKind,
  type NodeValueOutput,
} from './nodePorts';

/**
 * 新增画布节点 SOP：
 * 1. `canvasNodes.ts`：添加节点类型常量、Data 接口与类型守卫
 * 2. 本文件：添加 CanvasNodeDefinition（声明 media/ports/generation/getOutputs，
 *    生成类节点务必填 generation 与 ports，输出类节点填 getOutputs）
 * 3. `nodes/`：实现组件（生成类节点复用 nodes/shared/GenerationNodeShell，约 100~150 行）
 * 4. `nodes/index.ts`：注册到 nodeTypes 映射
 * 5. i18n：补充 `node.menu.*` 等文案键（zh-CN / en-US）
 *
 * 约束：禁止在组件或通用逻辑中写 `if (type === 'xxxNode')` 特判，
 * 行为差异一律通过本注册表的声明字段表达。
 */

export { canvasNodeDefinitions } from './nodeRegistryBuiltins';
export type {
  CanvasNodeCapabilities,
  CanvasNodeConnectivity,
  CanvasNodeDefinition,
  CanvasNodeExecutionKind,
  MenuIconKey,
  NodeMenuSection,
} from './nodeRegistryContracts';

export function getNodeDefinition(type: CanvasNodeType): CanvasNodeDefinition {
  return canvasNodeDefinitions[type];
}

/**
 * 运行时注册一个画布节点定义（第三方扩展接口的落点）。
 *
 * 内置节点在本模块静态注册；第三方扩展通过 CanvasExtension 在运行时调用本函数，
 * 之后该节点与内置节点走完全一致的渲染/连接/生成链路。
 */
export function registerCanvasNode(definition: CanvasNodeDefinition): void {
  (canvasNodeDefinitions as Record<string, CanvasNodeDefinition>)[definition.type] = definition;
}

/** 按类型取节点定义（不存在返回 undefined，区别于 getNodeDefinition 的非空契约） */
export function getCanvasNodeDefinition(type: CanvasNodeType | string): CanvasNodeDefinition | undefined {
  return (canvasNodeDefinitions as Record<string, CanvasNodeDefinition>)[type];
}

/**
 * 反查某个结果节点类型对应的媒体类型（exportVideoNode → 'video'）。
 * 从 generation.resultNodeType 声明推导，新增生成节点无需在这里补映射表。
 */
export function getResultNodeMediaType(
  resultNodeType: CanvasNodeType | string
): 'image' | 'video' | 'audio' | undefined {
  for (const definition of Object.values(canvasNodeDefinitions)) {
    if (definition.generation?.resultNodeType === resultNodeType) {
      return definition.generation.modelType;
    }
  }
  return undefined;
}

export function getMenuNodeDefinitions(): CanvasNodeDefinition[] {
  return Object.values(canvasNodeDefinitions).filter((definition) => definition.visibleInMenu);
}

export function nodeHasSourceHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.sourceHandle;
}

export function nodeHasTargetHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.targetHandle;
}

export function getConnectMenuNodeTypes(
  handleType: 'source' | 'target',
  fromNodeType?: CanvasNodeType
): CanvasNodeType[] {
  const fromSource = handleType === 'source';
  const fromDefinition = fromNodeType ? canvasNodeDefinitions[fromNodeType] : undefined;

  return Object.values(canvasNodeDefinitions)
    .filter((definition) => (fromSource
      ? definition.connectivity.connectMenu.fromSource
      : definition.connectivity.connectMenu.fromTarget))
    .filter((definition) => (fromSource
      ? definition.connectivity.targetHandle
      : definition.connectivity.sourceHandle))
    .filter((definition) => {
      if (!fromDefinition) {
        return true;
      }
      // 按端口媒体类型过滤：从输出端口拖出 → 候选节点需接受该媒体；反之亦然
      return fromSource
        ? arePortsCompatible(fromDefinition.ports, definition.ports)
        : arePortsCompatible(definition.ports, fromDefinition.ports);
    })
    .map((definition) => definition.type);
}

/** 连接是否类型兼容（上游 emits ∈ 下游 accepts） */
export function isConnectionCompatible(
  sourceType: CanvasNodeType,
  targetType: CanvasNodeType,
  sourceHandle?: string | null,
  sourceData?: CanvasNodeData,
): boolean {
  if (sourceData) {
    const emits = resolveNodeSourceMediaKind(sourceType, sourceData, sourceHandle)
    const accepts = canvasNodeDefinitions[targetType]?.ports?.target?.accepts
    if (emits) {
      return Boolean(accepts?.includes(emits))
    }
    const sourceDefinition = canvasNodeDefinitions[sourceType]
    const acceptedMediaKinds = accepts?.filter((kind): kind is MediaPortKind => (
      kind === 'image' || kind === 'video' || kind === 'audio'
    )) ?? []
    return Boolean(
      sourceDefinition?.connectivity.lockSourceMediaOnFirstConnection
      && (sourceHandle ?? 'source') === 'source'
      && acceptedMediaKinds.length === 1
      && Object.values(sourceDefinition.ports?.source?.handles ?? {})
        .includes(acceptedMediaKinds[0])
    )
  }
  return arePortsCompatible(
    canvasNodeDefinitions[sourceType]?.ports,
    canvasNodeDefinitions[targetType]?.ports,
    sourceHandle,
  );
}

/**
 * 解析节点当前允许使用的输出媒体类型。静态端口声明负责 handle→类型映射，
 * 可锁定节点再由 data 收窄，避免把运行时状态写成节点类型特判。
 */
export function resolveNodeSourceMediaKind(
  sourceType: CanvasNodeType,
  sourceData: CanvasNodeData,
  sourceHandle?: string | null,
): MediaPortKind | undefined {
  const definition = canvasNodeDefinitions[sourceType]
  const lockedKind = (sourceData as { lockedMediaKind?: DynamicValue }).lockedMediaKind
  const normalizedSourceHandle = sourceHandle ?? 'source'
  if (
    definition.connectivity.lockSourceMediaOnFirstConnection
    && normalizedSourceHandle === 'source'
  ) {
    return lockedKind === 'image' || lockedKind === 'video' || lockedKind === 'audio'
      ? lockedKind
      : undefined
  }
  const declaredKind = getSourcePortMediaKind(definition?.ports, sourceHandle)
  if (declaredKind !== 'image' && declaredKind !== 'video' && declaredKind !== 'audio') {
    return undefined
  }
  if (!definition.connectivity.lockSourceMediaOnFirstConnection) {
    return declaredKind
  }
  if (
    (lockedKind === 'image' || lockedKind === 'video' || lockedKind === 'audio')
    && lockedKind !== declaredKind
  ) {
    return undefined
  }
  return declaredKind
}

/** 节点是否允许从输出端口手动拖出连线 */
export function canNodeTypeStartManualConnection(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type]?.connectivity.manualSource === true;
}

/** 提取节点对下游的媒体输出 */
export function getNodeMediaOutputs(
  type: CanvasNodeType,
  data: CanvasNodeData,
  sourceHandle?: string,
): ReturnType<NonNullable<CanvasNodeDefinition['getOutputs']>> {
  const definition = canvasNodeDefinitions[type];
  return definition?.getOutputs?.(data, sourceHandle) ?? [];
}

/** 提取节点对下游参数端口的标量值输出（无则返回 null） */
export function getNodeValueOutput(
  type: CanvasNodeType,
  data: CanvasNodeData
): NodeValueOutput | null {
  const definition = canvasNodeDefinitions[type];
  return definition?.getValueOutput?.(data) ?? null;
}
