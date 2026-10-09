import { z } from 'zod'
import type { DocumentKindId } from '../documents/types'

/** 调用方中立的工具登记；入口与图标只保存登记名，执行装配留在渲染层。 */
export interface ToolDescriptor {
  readonly id: string
  readonly surfaceId: `tool.${string}`
  readonly titleKey: string
  readonly descriptionKey: string
  readonly icon: `ICON_${string}`
  readonly entryId: string
  readonly actions: readonly ('open' | 'recent_files')[]
  readonly recentFiles?: { readonly documentKind: DocumentKindId }
  readonly acceptedRefKinds: readonly string[]
  readonly capabilities: readonly string[]
}

export const TOOL_DESCRIPTORS = [
  {
    id: 'audioEdit', surfaceId: 'tool.audio_edit', entryId: 'audioEdit',
    titleKey: 'ui:toolbox.audioEdit.title', descriptionKey: 'ui:toolbox.audioEdit.description',
    icon: 'ICON_TOOL_AUDIO_EDIT', actions: ['open', 'recent_files'],
    recentFiles: { documentKind: 'audio_edit' },
    acceptedRefKinds: ['audio_edit.document', 'audio_edit.transcript_block', 'audio_edit.suggestion', 'audio_edit.render'],
    capabilities: ['project', 'transcript', 'suggestion', 'preview', 'export', 'vst3'],
  },
  {
    id: 'imageMark', surfaceId: 'tool.image_edit', entryId: 'imageMark',
    titleKey: 'ui:toolbox.imageMark.title', descriptionKey: 'ui:toolbox.imageMark.description',
    icon: 'ICON_TOOL_IMAGE_EDIT', actions: ['open', 'recent_files'],
    recentFiles: { documentKind: 'image_document' },
    acceptedRefKinds: ['image_edit.document', 'image_edit.layer', 'generation.result', 'asset'],
    capabilities: ['preview', 'commit'],
  },
  {
    id: 'cameraStage', surfaceId: 'tool.camera_stage', entryId: 'cameraStage',
    titleKey: 'ui:toolbox.cameraStage.title', descriptionKey: 'ui:toolbox.cameraStage.description',
    icon: 'ICON_TOOL_CAMERA_STAGE', actions: ['open', 'recent_files'],
    recentFiles: { documentKind: 'camera_stage' },
    acceptedRefKinds: ['camera_stage.document', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.state_keyframe', 'camera_stage.trajectory'],
    capabilities: ['project', 'object', 'state_keyframe', 'camera_move', 'render'],
  },
] as const satisfies readonly ToolDescriptor[]

type ToolEnum<T extends string> = z.ZodEnum<{ [K in T]: K }>
export interface ToolCatalog<T extends ToolDescriptor> {
  tools: readonly T[]
  idSchema: ToolEnum<T['id']>
  surfaceIdSchema: ToolEnum<T['surfaceId']>
  selectionInputSchema: z.ZodType<{ toolId: T['id'] | null }>
  selectionOutputShape: { toolId: z.ZodNullable<ToolEnum<T['id']>>; surfaceId: z.ZodNullable<ToolEnum<T['surfaceId']>> }
  get: (id: string) => T | undefined
}

export function createToolCatalog<const T extends readonly ToolDescriptor[]>(descriptors: T): ToolCatalog<T[number]> {
  const tools = [...descriptors]
  for (const key of ['id', 'surfaceId', 'entryId'] as const) {
    if (new Set(tools.map((tool) => tool[key])).size !== tools.length) throw new Error(`工具登记 ${key} 重复`)
  }
  for (const tool of tools) {
    if (tool.actions.includes('recent_files') !== Boolean(tool.recentFiles)) {
      throw new Error(`工具 ${tool.id} 的最近文件动作与提供器登记不一致`)
    }
  }
  if (!tools.length) throw new Error('工具目录不能为空')
  const idSchema = z.enum(tools.map((tool) => tool.id) as [T[number]['id'], ...T[number]['id'][]])
  const surfaceIdSchema = z.enum(tools.map((tool) => tool.surfaceId) as [T[number]['surfaceId'], ...T[number]['surfaceId'][]])
  return {
    tools: tools as readonly T[number][],
    idSchema,
    surfaceIdSchema,
    selectionInputSchema: z.object({ toolId: idSchema.nullable() }).strict(),
    selectionOutputShape: { toolId: idSchema.nullable(), surfaceId: surfaceIdSchema.nullable() },
    get: (id: string): T[number] | undefined => tools.find((tool) => tool.id === id),
  }
}

export const TOOL_CATALOG = createToolCatalog(TOOL_DESCRIPTORS)
export const toolboxToolIdSchema = TOOL_CATALOG.idSchema
export type ToolboxToolId = (typeof TOOL_DESCRIPTORS)[number]['id']
