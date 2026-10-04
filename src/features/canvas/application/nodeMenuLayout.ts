import type { CanvasMediaKind } from '@/features/canvas/canvasUtils'
import type {
  CanvasNodeDefinition,
  NodeMenuSection,
} from '@/features/canvas/domain/nodeRegistry'

export const NODE_MENU_SECTION_ORDER: NodeMenuSection[] = [
  'media',
  'textTools',
  'models',
  'parameters',
  'extensions',
]

export const NODE_MENU_SECTION_LABEL_KEY: Record<NodeMenuSection, string> = {
  media: 'node.menuSections.media',
  textTools: 'node.menuSections.textTools',
  models: 'node.menuSections.models',
  parameters: 'node.menuSections.parameters',
  extensions: 'node.menuSections.extensions',
}

export function getSortedNodeMenuDefinitions(
  definitions: CanvasNodeDefinition[]
): CanvasNodeDefinition[] {
  const deduped = new Map<string, CanvasNodeDefinition>()
  for (const definition of definitions) {
    const key = definition.menuAggregationKey ?? definition.type
    if (!deduped.has(key)) {
      deduped.set(key, definition)
    }
  }
  return Array.from(deduped.values()).sort((left, right) => {
    const sectionDelta = NODE_MENU_SECTION_ORDER.indexOf(left.menuSection ?? 'extensions')
      - NODE_MENU_SECTION_ORDER.indexOf(right.menuSection ?? 'extensions')
    return sectionDelta
      || (left.menuOrder ?? Number.MAX_SAFE_INTEGER) - (right.menuOrder ?? Number.MAX_SAFE_INTEGER)
  })
}

export function getUploadAccept(kinds: CanvasMediaKind[]): string {
  return kinds.map((kind) => `${kind}/*`).join(',')
}
