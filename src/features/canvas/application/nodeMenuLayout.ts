import type { CanvasMediaKind } from '@/features/canvas/canvasUtils'
import type {
  CanvasNodeDefinition,
  NodeMenuSection,
} from '@/features/canvas/domain/nodeRegistry'

const NODE_MENU_MARGIN = 12
export const NODE_MENU_MAX_HEIGHT = 520

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

export function resolveNodeMenuLayout({
  position,
  parentWidth,
  parentHeight,
  menuWidth,
  menuHeight,
}: {
  position: { x: number; y: number }
  parentWidth: number
  parentHeight: number
  menuWidth: number
  menuHeight: number
}) {
  const maxHeight = Math.min(
    NODE_MENU_MAX_HEIGHT,
    Math.max(160, parentHeight - NODE_MENU_MARGIN * 2)
  )
  const renderedHeight = Math.min(menuHeight, maxHeight)
  const flipX = position.x + menuWidth > parentWidth - NODE_MENU_MARGIN
  const flipY = position.y + renderedHeight > parentHeight - NODE_MENU_MARGIN
  const left = flipX ? position.x - menuWidth : position.x
  const top = flipY ? position.y - renderedHeight : position.y
  return {
    left: Math.max(
      NODE_MENU_MARGIN,
      Math.min(left, parentWidth - menuWidth - NODE_MENU_MARGIN)
    ),
    top: Math.max(
      NODE_MENU_MARGIN,
      Math.min(top, parentHeight - renderedHeight - NODE_MENU_MARGIN)
    ),
    maxHeight,
    transformOrigin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`,
  }
}
