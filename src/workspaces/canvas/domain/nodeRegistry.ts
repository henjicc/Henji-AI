import { registry } from '@/core/ModelRegistry'
import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
  type ImageSize,
  type StoryboardGenFrameItem,
} from '@/workspaces/canvas/types'

export type MenuIconKey = 'upload' | 'sparkles' | 'layout' | 'text'

export interface CanvasNodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: CanvasNodeType
  menuLabel: string
  menuIcon: MenuIconKey
  visibleInMenu: boolean
  createDefaultData: () => TData
}

function defaultImageModelId(): string {
  const first = registry.getModelsByType('image')[0]
  return first?.meta.id ?? ''
}

function createStoryboardFrames(rows: number, cols: number): StoryboardGenFrameItem[] {
  const total = Math.max(1, rows) * Math.max(1, cols)
  return Array.from({ length: total }, (_v, index) => ({
    id: `f-${index + 1}`,
    description: '',
    referenceIndex: null,
  }))
}

const DEFAULT_IMAGE_SIZE: ImageSize = '2K'

export const canvasNodeDefinitions: Record<CanvasNodeType, CanvasNodeDefinition> = {
  [CANVAS_NODE_TYPES.upload]: {
    type: CANVAS_NODE_TYPES.upload,
    menuLabel: '上传图片',
    menuIcon: 'upload',
    visibleInMenu: true,
    createDefaultData: () => ({
      displayName: '上传图片',
      imageUrl: null,
      filePath: '',
      aspectRatio: '1:1',
    }),
  },
  [CANVAS_NODE_TYPES.imageEdit]: {
    type: CANVAS_NODE_TYPES.imageEdit,
    menuLabel: 'AI 图片生成',
    menuIcon: 'sparkles',
    visibleInMenu: true,
    createDefaultData: () => {
      const model = defaultImageModelId()
      return {
        displayName: 'AI 图片生成',
        imageUrl: null,
        filePath: '',
        prompt: '',
        model,
        size: DEFAULT_IMAGE_SIZE,
        requestAspectRatio: 'auto',
        params: model ? registry.getDefaultValues(model) : {},
        isGenerating: false,
        progress: 0,
        error: '',
      }
    },
  },
  [CANVAS_NODE_TYPES.exportImage]: {
    type: CANVAS_NODE_TYPES.exportImage,
    menuLabel: '结果图',
    menuIcon: 'upload',
    visibleInMenu: false,
    createDefaultData: () => ({
      displayName: '结果图',
      imageUrl: null,
      filePath: '',
      mediaType: 'image',
      resultKind: 'generic',
    }),
  },
  [CANVAS_NODE_TYPES.textAnnotation]: {
    type: CANVAS_NODE_TYPES.textAnnotation,
    menuLabel: '文本标注',
    menuIcon: 'text',
    visibleInMenu: true,
    createDefaultData: () => ({
      displayName: '文本标注',
      content: '',
    }),
  },
  [CANVAS_NODE_TYPES.storyboardGen]: {
    type: CANVAS_NODE_TYPES.storyboardGen,
    menuLabel: '分镜生成',
    menuIcon: 'sparkles',
    visibleInMenu: true,
    createDefaultData: () => ({
      displayName: '分镜生成',
      gridRows: 2,
      gridCols: 2,
      frames: createStoryboardFrames(2, 2),
      model: defaultImageModelId(),
      size: DEFAULT_IMAGE_SIZE,
      requestAspectRatio: 'auto',
      extraParams: {},
      isGenerating: false,
      progress: 0,
      error: '',
    }),
  },
  [CANVAS_NODE_TYPES.storyboardSplit]: {
    type: CANVAS_NODE_TYPES.storyboardSplit,
    menuLabel: '分镜切割',
    menuIcon: 'layout',
    visibleInMenu: true,
    createDefaultData: () => ({
      displayName: '分镜切割',
      gridRows: 2,
      gridCols: 2,
      frames: [],
      frameAspectRatio: '1:1',
      isSplitting: false,
      error: '',
    }),
  },
}

export function getNodeDefinition(type: CanvasNodeType): CanvasNodeDefinition {
  return canvasNodeDefinitions[type]
}

export function getMenuNodeDefinitions(): CanvasNodeDefinition[] {
  return Object.values(canvasNodeDefinitions).filter((item) => item.visibleInMenu)
}
