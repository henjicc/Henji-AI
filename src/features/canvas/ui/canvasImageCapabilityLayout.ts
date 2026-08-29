import type {
  CanvasImageCapabilityDefinition,
  CanvasImageCapabilityGroup,
  CanvasImageCapabilityId,
} from '@/features/canvas/capabilities'
import {
  getRegisteredCanvasImageCapabilities,
  isCanvasImageCapabilityExecutable,
  isCanvasImageCapabilityFeatureEnabled,
} from '@/features/canvas/capabilities'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import {
  getNodeDefinition,
  getNodeMediaOutputs,
  resolveNodeSourceMediaKind,
} from '@/features/canvas/domain/nodeRegistry'
import type { CanvasToolPlugin } from '@/features/canvas/tools'

const IMAGE_CAPABILITY_SOURCE_NOT_READY_KEY = 'imageCapabilities.unavailable.sourceNotReady'

const CAPABILITY_TOOLBAR_PRIORITY: Readonly<Record<CanvasImageCapabilityId, number>> = {
  'image.element-edit': 10,
  'image.upscale': 20,
  'image.relight': 30,
  'image.panorama': 40,
  'image.multi-angle': 50,
  'image.nine-grid': 60,
  'image.portrait-texture': 70,
  'image.layer-separation': 80,
  'image.grid-split': 90,
}

export interface CanvasImageCapabilityAction {
  capability: CanvasImageCapabilityDefinition
  disabledReasonKey: string | null
}

export type CanvasImageCapabilityMenuGroup = 'transformation' | 'structure' | 'local'

const MENU_GROUPS: ReadonlyArray<{
  group: CanvasImageCapabilityMenuGroup
  labelKey: string
  sourceGroups: readonly CanvasImageCapabilityGroup[]
}> = [
  {
    group: 'transformation',
    labelKey: 'imageCapabilities.groups.transformation',
    sourceGroups: ['generation', 'enhancement', 'editing'],
  },
  {
    group: 'structure',
    labelKey: 'imageCapabilities.groups.structure',
    sourceGroups: ['structure'],
  },
  {
    group: 'local',
    labelKey: 'imageCapabilities.groups.local',
    sourceGroups: ['local'],
  },
]

/**
 * 工具条是 ReactFlow 选中态浮层，宽度受窗口而不是节点测量盒约束。
 * 只按低频窗口 resize 更新容量，不读取画布节点列表或缩放状态。
 */
export function resolveCanvasImageCapabilityInlineCapacity(viewportWidth: number): number {
  if (viewportWidth >= 1360) return 4
  if (viewportWidth >= 1080) return 3
  if (viewportWidth >= 760) return 2
  return 1
}

export type CanvasImageCapabilityMenuNavigationKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'Home'
  | 'End'

export function resolveCanvasImageCapabilityMenuFocusIndex(
  currentIndex: number,
  itemCount: number,
  key: CanvasImageCapabilityMenuNavigationKey,
): number {
  if (itemCount <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (currentIndex < 0 || currentIndex >= itemCount) {
    return key === 'ArrowUp' ? itemCount - 1 : 0
  }
  return key === 'ArrowDown'
    ? (currentIndex + 1) % itemCount
    : (currentIndex - 1 + itemCount) % itemCount
}

export interface CanvasImageCapabilityPartition {
  inline: readonly CanvasImageCapabilityAction[]
  overflowGroups: ReadonlyArray<{
    group: CanvasImageCapabilityMenuGroup
    labelKey: string
    actions: readonly CanvasImageCapabilityAction[]
  }>
}

/**
 * 生成面板的真实可用性列表。完全不适用或尚未实现的能力不会进入 UI；
 * 已实现但缺图片、或仍受发布闸门约束的能力保留禁用原因。
 */
export function resolveCanvasImageCapabilityActionsForSourceNode(
  sourceNode: CanvasNode,
): readonly CanvasImageCapabilityAction[] {
  if (getNodeDefinition(sourceNode.type).capabilities.toolbarImageCapabilities === false) {
    return []
  }
  const outputs = getNodeMediaOutputs(sourceNode.type, sourceNode.data)
  const declaredKind = resolveNodeSourceMediaKind(sourceNode.type, sourceNode.data)
  const mediaRole = getNodeDefinition(sourceNode.type).media?.role

  // 生成器只保存输入与参数，真实结果会落到独立结果节点。静态输出端口表示“将来会
  // 生成图片”，不能据此给尚无结果的生成器展示一整组不可用的派生能力。
  if (outputs.length === 0 && mediaRole === 'generator') return []

  return getRegisteredCanvasImageCapabilities()
    .filter((capability) => capability.implementation.status === 'implemented')
    .filter((capability) => {
      const matchingOutputCount = outputs.filter((output) => (
        output.kind === 'image'
        || output.kind === 'video'
        || output.kind === 'audio'
      ) && capability.source.mediaTypes.includes(output.kind)).length
      if (matchingOutputCount > 0) {
        return matchingOutputCount >= capability.source.minCount
          && matchingOutputCount <= capability.source.maxCount
      }
      return outputs.length === 0
        && declaredKind !== undefined
        && capability.source.mediaTypes.includes(declaredKind)
    })
    .map((capability): CanvasImageCapabilityAction => {
      const featureEnabled = isCanvasImageCapabilityFeatureEnabled(capability)
      if (!featureEnabled || !isCanvasImageCapabilityExecutable(capability)) {
        return {
          capability,
          disabledReasonKey: capability.availability.unavailableReasonKey
            ?? 'imageCapabilities.unavailable.planned',
        }
      }
      const matchingOutputCount = outputs.filter((output) => (
        output.kind === 'image'
        || output.kind === 'video'
        || output.kind === 'audio'
      ) && capability.source.mediaTypes.includes(output.kind)).length
      return {
        capability,
        disabledReasonKey: capability.source.requireMaterializedMedia && matchingOutputCount === 0
          ? IMAGE_CAPABILITY_SOURCE_NOT_READY_KEY
          : null,
      }
    })
    .sort((left, right) => (
      CAPABILITY_TOOLBAR_PRIORITY[left.capability.id]
      - CAPABILITY_TOOLBAR_PRIORITY[right.capability.id]
    ))
}

export function partitionCanvasImageCapabilities(
  actions: readonly CanvasImageCapabilityAction[],
  inlineCapacity: number,
): CanvasImageCapabilityPartition {
  const inline = actions
    .filter((action) => action.disabledReasonKey === null)
    .slice(0, Math.max(0, inlineCapacity))
  const inlineIds = new Set(inline.map(({ capability }) => capability.id))
  const overflow = actions.filter(({ capability }) => !inlineIds.has(capability.id))
  const overflowGroups = MENU_GROUPS
    .map(({ group, labelKey, sourceGroups }) => ({
      group,
      labelKey,
      actions: overflow.filter(({ capability }) => sourceGroups.includes(capability.group)),
    }))
    .filter(({ actions: groupActions }) => groupActions.length > 0)

  return { inline, overflowGroups }
}

export function excludeClaimedLocalTools(
  tools: readonly CanvasToolPlugin[],
  capabilities: readonly CanvasImageCapabilityDefinition[],
): readonly CanvasToolPlugin[] {
  const claimedToolTypes = new Set(capabilities.flatMap((capability) => (
    capability.implementation.status === 'implemented'
    && capability.implementation.execution.kind === 'local-tool'
      ? [capability.implementation.execution.toolType]
      : []
  )))
  return tools.filter((tool) => !claimedToolTypes.has(tool.type))
}
