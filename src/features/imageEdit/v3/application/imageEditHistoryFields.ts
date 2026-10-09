import { z } from 'zod'
import type { ApplicationFieldDefinition, ApplicationPropertyDescriptor, JsonValue } from '@/core/application-control'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { imageEditV3SchemaRef } from './imageEditV3Fields'

export const imageEditHistoryRowsSchemaV3 = z.array(z.object({ position: z.number().int().nonnegative(), kind: z.enum(['initial', 'document', 'selection']), label: z.string(), targetName: z.string().nullable() }).strict())
export interface ImageEditHistoryMutationDraftV3 { position?: number }
function descriptor(suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], description: string, readOnlyReason?: string): ApplicationPropertyDescriptor {
  const id = `image_edit.document.${suffix}`
  return { id, entityType: 'image_edit.document', version: 1, title, description, value, nullable: false,
    dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['image_edit:read'], write: readOnlyReason ? [] : ['image_edit:write'] },
    revisionScopes: ['image_edit'], schemaRef: imageEditV3SchemaRef('property', id), ...(readOnlyReason ? { readOnlyReason } : {}) }
}
export const IMAGE_EDIT_HISTORY_FIELDS_V3: ApplicationFieldDefinition<ImageEditCommandBusV3, ImageEditHistoryMutationDraftV3>[] = [
  { propertyId: 'image_edit.document.history_position',
    descriptor: descriptor('history_position', '历史当前位置', { kind: 'integer', hardRange: { min: 0 } }, '选择历史记录完成后的位置。0 回到开始编辑，history_length 回到最新；先读 history_entries 选择操作。恢复过程中可取消，失败保持当前编辑内容。'),
    read: bus => bus.getHistoryView().position,
    writer: { write(draft, mutation) { if (!Number.isSafeInteger(mutation.value) || Number(mutation.value) < 0) throw new Error('history_position 必须是非负安全整数，请读取 history_length 确认可恢复范围'); draft.position = Number(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.document.history_length',
    descriptor: descriptor('history_length', '历史记录数', { kind: 'integer', hardRange: { min: 0 } }, '当前文档实例可以恢复的操作总数，包含撤销后的操作。', '由文档命令与会话选区共同维护，不能增删计数。'),
    read: bus => bus.getHistoryView().total, storeActions: [] },
  { propertyId: 'image_edit.document.history_entries',
    descriptor: descriptor('history_entries', '编辑历史', { kind: 'json', schemaRef: imageEditV3SchemaRef('property', 'image_edit.document.history_entries.value') }, '按操作顺序列出名称、位置与操作类型。选区仅存在于当前编辑会话，关闭后不恢复。', '历史记录由正式编辑操作维护；通过 history_position 恢复所选位置。'),
    read: bus => {
      const rows: JsonValue[] = []
      for (let offset = 0; offset <= bus.getHistoryView().total; offset += 64) {
        for (const { position, kind, label, targetName } of bus.readHistoryPage(offset)) rows.push({ position, kind, label, targetName })
      }
      return rows
    }, storeActions: [] },
]
