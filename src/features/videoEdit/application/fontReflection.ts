import { z } from 'zod'
import { unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type JsonValue, fieldDescriptors, fieldReadValues } from '@/core/application-control'
import type { FontFaceInfo } from '@/core/fonts/catalog'
import { fontLibrarySnapshot, loadFontLibrary } from '@/platform/fonts'
import { videoEditSchemaRef } from './videoEditFields'
const reason = '本机字体由操作系统安装，导入字体由用户授权的本地字体文件选择器维护；查询后把 name 或 family 写入文字、图形、模板、字幕及 font 类型代码参数。删除系统字体与任意文件读写不属于字体目录的写权限。'
const schemaRef = (name: string): ReturnType<typeof videoEditSchemaRef> => videoEditSchemaRef(name === 'entity' ? 'entity' : 'property', name === 'entity' ? 'font' : `font.${name}`)
const fields: ApplicationFieldDefinition<FontFaceInfo, FontFaceInfo>[] = [
  ['name', '字体样式名', 'fullName', 'string'], ['family', '字体家族名', 'family', 'string'], ['localized_name', '中文字体名', 'localizedFamily', 'string'], ['postscript_name', 'PostScript 名', 'postscriptName', 'string'],
  ['style', '真实样式', 'style', 'string'], ['weight', '真实字重', 'weight', 'number'], ['category', '字体分类', 'category', 'string'], ['supports_cjk', '包含中文字形', 'supportsCjk', 'boolean'], ['imported', '用户导入字体', 'imported', 'boolean'],
].map(([name, title, key, kind]) => ({
  propertyId: `font.${name}`, storeActions: [], read: face => face[key as keyof FontFaceInfo] as string | number | boolean,
  descriptor: { id: `font.${name}`, entityType: 'font', version: 1, title, description: `${title}。可在 list_application_entities 的 where 按此属性等值过滤，并用 limit/cursor 分页。`, value: { kind: kind as 'string' | 'number' | 'boolean' }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['fonts'], schemaRef: schemaRef(name), readOnlyReason: reason },
}))
fields.push({
  propertyId: 'font.axes', storeActions: [], read: face => (face.axes ?? []).map(axis => ({ ...axis })),
  descriptor: { id: 'font.axes', entityType: 'font', version: 1, title: '可变字体变化轴', description: '可变字体的全部变化轴 [{tag 四字符轴标签, name 字体自带名称, min, default, max}]；空数组表示不是可变字体。把数值写进文字样式 fontVariations（{tag: 数值}，在 min–max 内连续取值）即可得到任意中间字重、字宽等；剪辑文字片段的轴动画写 video_edit.clip.font_variation_keyframes。', value: { kind: 'json', schemaRef: schemaRef('axes.value') }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['fonts'], schemaRef: schemaRef('axes'), readOnlyReason: reason },
})
// json 属性的值 schema 必须随实体一起登记：缺了它，查询剪辑领域结构时整域都会报 SCHEMA_NOT_FOUND。
const axesValueSchema = z.array(z.object({ tag: z.string(), name: z.string(), min: z.number(), default: z.number(), max: z.number() }).strict())
export function createFontRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => ({ fonts: fontLibrarySnapshot().revision })
  const requireFace = async (ref: { kind: string; id: string }): Promise<FontFaceInfo> => { const library = await loadFontLibrary(); const face = library.faces.find(value => value.id === ref.id); if (ref.kind !== 'font' || !face) throw new Error('字体不存在，请重新查询 font 实体。'); return face }
  return {
    entity: { id: 'font', domain: 'video_edit', version: 1, title: '可用字体', description: '本机与导入字体；family/中文名查询，category（serif/sans-serif/monospace/handwriting/unknown）、supports_cjk 与 imported 支持等值筛选。分页后读取 name，可用于所有剪辑字体字段；axes 非空的是可变字体，可在轴范围内连续取值。', refKind: 'font', dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['fonts'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity'), writeExclusion: { reason } },
    properties: fieldDescriptors(fields),
    schemaDocuments: [{ ref: schemaRef('axes.value'), value: z.toJSONSchema(axesValueSchema) as JsonValue, validator: axesValueSchema }],
    provider: {
      entityType: 'font',
      async listEntities(request) { const { faces } = await loadFontLibrary(true); const offset = Math.max(0, Number(request.cursor) || 0); return { refs: faces.slice(offset, offset + request.limit).map(face => ({ kind: 'font', id: face.id, label: `${face.localizedFamily} / ${face.style}` })), nextCursor: offset + request.limit < faces.length ? String(offset + request.limit) : null, revisions: revisions() } },
      async readEntity(ref, request) { const values = fieldReadValues(fields, await requireFace(ref)); return { ref, entityType: 'font', revisions: revisions(), properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds!.includes(id))) : values, capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) { await requireFace(ref); return propertyIds.map(propertyId => { if (!fields.some(field => field.propertyId === propertyId)) throw new Error(`未知字体属性 ${propertyId}，可用：${fields.map(field => field.propertyId).join('、')}`); return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['video_edit:read'], revisions: revisions() } }) },
      async getCollectionAvailability(parent) { const result = unrestrictedCollectionAvailability('font', parent, revisions(), ['video_edit:read']); result.create = { ...result.create, available: false, reasons: [reason] }; result.remove = { ...result.remove, available: false, reasons: [reason] }; return result },
    },
  }
}
