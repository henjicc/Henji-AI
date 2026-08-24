import { z } from 'zod'

import {
  fieldWriterTable,
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'
import type { CanvasNode } from '@/stores/canvasStore'

import { isAssetGroupNode, isStoryboardSplitNode } from '../domain/canvasNodes'
import type { CanvasNodePropertyPatch, CanvasStoryboardFramePatch } from './canvasMutationService'
import { renameCanvasProject } from './canvasProjectService'

/*
 * 画布工程与节点的可写属性统一定义——1.3 迁移（project.name 1 + node.display_name/position 2），
 * 3.2 又加了 node.storyboard_frames 1 条。不单独抽公共 shared 模块（像三维那样）：画布这边
 * 字段不多，样板重复换不来收益。
 */

const PROJECT_ENTITY_TYPE = 'canvas.project' as const
const NODE_ENTITY_TYPE = 'canvas.node' as const
const REVISION_SCOPE = 'canvas' as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function canvasDescriptor(
  entityType: string,
  suffix: string,
  title: string,
  value: ApplicationPropertyValue,
  description?: string,
  nullable = false,
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: description ?? `画布${title}的稳定控制属性。`,
    value,
    nullable,
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

const STORYBOARD_FRAMES_VALUE: ApplicationPropertyValue = {
  kind: 'json',
  schemaRef: {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'property',
    id: `${NODE_ENTITY_TYPE}.storyboard_frames.value`,
    version: 1,
    digest: digest(`property:${NODE_ENTITY_TYPE}.storyboard_frames.value`),
  },
}

const ASSET_GROUP_MEMBER_ORDER_VALUE: ApplicationPropertyValue = {
  kind: 'json',
  schemaRef: {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'property',
    id: `${NODE_ENTITY_TYPE}.asset_group_member_order.value`,
    version: 1,
    digest: digest(`property:${NODE_ENTITY_TYPE}.asset_group_member_order.value`),
  },
}

const storyboardFramePatchSchema = z.object({
  id: z.string().min(1),
  note: z.string().max(4_000).optional(),
  order: z.number().int().min(0).optional(),
}).strict()

const assetGroupMemberOrderSchema = z.array(z.string().min(1)).max(200)

function parseStoryboardFramePatches(raw: JsonValue | undefined): CanvasStoryboardFramePatch[] {
  return z.array(storyboardFramePatchSchema).min(1).max(200).parse(raw)
}

/** 写入目标是节点补丁本身——两条属性合成一个 patch 再整体提交，逐条提交会产生两次历史记录。 */
export const NODE_FIELDS: ApplicationFieldDefinition<
  CanvasNode, CanvasNodePropertyPatch, 'updateNodePosition' | 'updateStoryboardFrame' | 'reorderStoryboardFrame'
>[] = [
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
  /*
   * 只对 storyboardSplit 类型节点有意义（3.2）：读取对其他节点类型返回空数组，而不是省略这条
   * 属性——canvas.node 是所有节点类型共享的同一份属性描述符列表，没有按实例类型过滤声明的机制
   * （不像三维 animatable.* 那样已经建了这一层）。写入按 id 定点更新 note/order；order 直接写入
   * 即完成排序（reorderStoryboardFrame 内部也是把移动后每张卡的 order 重新赋值为数组下标，
   * 直接写 order 是同一件事）。
   */
  {
    propertyId: `${NODE_ENTITY_TYPE}.storyboard_frames`,
    descriptor: canvasDescriptor(NODE_ENTITY_TYPE, 'storyboard_frames', '分镜格子', STORYBOARD_FRAMES_VALUE,
      '只对分镜格子节点（storyboardSplit）有意义，其他节点类型读到空数组。数组元素 {id, note, order}：'
      + 'note 是格子说明文字，order 决定排列顺序（越小越靠前）。写入按 id 定点更新，只需要传要改的字段；'
      + 'id 必须取自读取结果里的原值，不支持增删格子。'),
    read: (node) => (isStoryboardSplitNode(node)
      ? node.data.frames.map((frame) => ({ id: frame.id, note: frame.note, order: frame.order }))
      : []) as JsonValue,
    writer: {
      write(patch, mutation) {
        patch.storyboardFrames = parseStoryboardFramePatches(mutation.value)
      },
    },
    storeActions: ['updateStoryboardFrame', 'reorderStoryboardFrame'],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.asset_group_member_order`,
    descriptor: canvasDescriptor(
      NODE_ENTITY_TYPE,
      'asset_group_member_order',
      '素材组成员顺序',
      ASSET_GROUP_MEMBER_ORDER_VALUE,
      '只对素材组节点有意义。值为成员节点 ID 数组；排序同时决定容量不足时的自动连接优先级。',
    ),
    read: (node) => (isAssetGroupNode(node) ? node.data.memberOrder : []) as JsonValue,
    writer: {
      write(patch, mutation) {
        patch.assetGroupMemberOrder = assetGroupMemberOrderSchema.parse(mutation.value)
      },
    },
    storeActions: [],
  },
  {
    propertyId: `${NODE_ENTITY_TYPE}.asset_group_cover_member_id`,
    descriptor: canvasDescriptor(
      NODE_ENTITY_TYPE,
      'asset_group_cover_member_id',
      '素材组封面成员',
      { kind: 'string', minLength: 1, maxLength: 160 },
      '只对素材组节点有意义。写入组内成员节点 ID；null 表示保持当前自动封面。',
      true,
    ),
    read: (node) => (isAssetGroupNode(node) ? node.data.coverMemberId : null),
    writer: {
      write(patch, mutation) {
        if (mutation.value !== null && typeof mutation.value !== 'string') throw new Error('INVALID_INPUT')
        patch.assetGroupCoverMemberId = mutation.value
      },
    },
    storeActions: [],
  },
]

export const CANVAS_PROJECT_WRITERS = fieldWriterTable(PROJECT_FIELDS)
export const CANVAS_NODE_WRITERS = fieldWriterTable(NODE_FIELDS)
