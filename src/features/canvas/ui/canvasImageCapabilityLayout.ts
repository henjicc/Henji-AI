import type {
  CanvasImageCapabilityDefinition,
  CanvasImageCapabilityGroup,
} from '@/features/canvas/capabilities'
import type { CanvasToolPlugin } from '@/features/canvas/tools'

const MAX_INLINE_CAPABILITIES_WITHOUT_OVERFLOW = 3
const INLINE_CAPABILITIES_WITH_OVERFLOW = 2

export interface CanvasImageCapabilityPartition {
  inline: readonly CanvasImageCapabilityDefinition[]
  overflowGroups: ReadonlyArray<{
    group: CanvasImageCapabilityGroup
    labelKey: string
    capabilities: readonly CanvasImageCapabilityDefinition[]
  }>
}

export function partitionCanvasImageCapabilities(
  capabilities: readonly CanvasImageCapabilityDefinition[],
): CanvasImageCapabilityPartition {
  const inlineCount = capabilities.length <= MAX_INLINE_CAPABILITIES_WITHOUT_OVERFLOW
    ? capabilities.length
    : INLINE_CAPABILITIES_WITH_OVERFLOW
  const inline = capabilities.slice(0, inlineCount)
  const overflow = capabilities.slice(inlineCount)
  const grouped = new Map<CanvasImageCapabilityGroup, {
    group: CanvasImageCapabilityGroup
    labelKey: string
    capabilities: CanvasImageCapabilityDefinition[]
  }>()

  for (const capability of overflow) {
    const existing = grouped.get(capability.group)
    if (existing) {
      existing.capabilities.push(capability)
    } else {
      grouped.set(capability.group, {
        group: capability.group,
        labelKey: capability.groupLabelKey,
        capabilities: [capability],
      })
    }
  }

  return { inline, overflowGroups: [...grouped.values()] }
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
