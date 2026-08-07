import {
  fieldWriterTable,
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'
import type { CanvasNode } from '@/stores/canvasStore'

import type { CanvasNodePropertyPatch } from './canvasMutationService'
import { renameCanvasProject } from './canvasProjectService'

/*
 * 画布工程与节点的 3 条可写属性（project.name 1 + node.display_name/position 2）的统一
 * 定义——1.3 迁移。不单独抽公共 shared 模块（像三维那样）：画布这边只有 3 条，样板重复
 * 换不来收益。
 */

const PROJECT_ENTITY_TYPE = 'canvas.project' as const
const NODE_ENTITY_TYPE = 'canvas.node' as const
const REVISION_SCOPE = 'canvas' as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function canvasDescriptor(entityType: string, suffix: string, title: string, value: ApplicationPropertyValue): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `画布${title}的稳定控制属性。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['canvas:read'], write: ['canvas:write'] },
    revisionScopes: [REVISION_SCOPE],
    schemaRef: {
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      kind: 'property',
      id,
      version: 1,
      digest: digest(`property:${id}`),
    },
  }
}

/** 写入目标只有工程 id——改名直接落到领域服务，没有需要累积的中间态。 */
export const PROJECT_FIELDS: ApplicationFieldDefinition<{ name: string }, string>[] = [
  {
    propertyId: `${PROJECT_ENTITY_TYPE}.name`,
    descriptor: canvasDescriptor(PROJECT_ENTITY_TYPE, 'name', '项目名称', { kind: 'string', minLength: 1, maxLength: 120 }),
    read: (project) => project.name,
    writer: {
      async write(projectId, mutation) {
        if (typeof mutation.value !== 'string' || mutation.value.trim() === '') {
          throw new Error('CANVAS_PROJECT_NAME_INVALID：工程名必须是非空字符串。')
        }
        await renameCanvasProject(projectId, mutation.value)
      },
    },
    storeActions: [],
  },
]

function vector2(value: JsonValue | undefined): { x: number; y: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT')
  const x = value.x
  const y = value.y
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new Error('INVALID_INPUT')
  }
  return { x, y }
}

/** 写入目标是节点补丁本身——两条属性合成一个 patch 再整体提交，逐条提交会产生两次历史记录。 */
export const NODE_FIELDS: ApplicationFieldDefinition<CanvasNode, CanvasNodePropertyPatch, 'updateNodePosition'>[] = [
  {
    propertyId: `${NODE_ENTITY_TYPE}.display_name`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'display_name', '节点标题', { kind: 'string', minLength: 1, maxLength: 120 }),
    read: (node) => node.data.displayName ?? node.type,
    writer: {
      write(patch, mutation) {
        if (typeof mutation.value !== 'string' || !mutation.value.trim()) throw new Error('INVALID_INPUT')
        patch.displayName = mutation.value
      },
    },
    // updateNodeData 已经以 capability 形式绑定在 canvasStoreLedger.ts，这里不重复声明。
    storeActions: [],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.position`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'position', '节点位置', { kind: 'vector2', unit: 'canvas_pixel' }),
    read: (node) => ({ x: node.position.x, y: node.position.y }),
    writer: {
      write(patch, mutation) {
        if (mutation.value === undefined) throw new Error('INVALID_INPUT')
        patch.position = vector2(mutation.value)
      },
    },
    storeActions: ['updateNodePosition'],
  },
]

export const CANVAS_PROJECT_WRITERS = fieldWriterTable(PROJECT_FIELDS)
export const CANVAS_NODE_WRITERS = fieldWriterTable(NODE_FIELDS)
