import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationFieldDefinition, type ApplicationEntityRegistration, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationExecutionContext, type ApplicationCompletedStepResult, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, writableProperties, propertyOperations } from '@/core/application-control/execution/writerTable'
import { codeElementEdits, type CodeEditActor } from '@/core/videoEdit/codeEdits'
import { CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { codeElementOverrideSchema, codeElementOverrideValuesSchema } from '@/core/videoEdit/codeElementOverrides'
import { codeMaterialCurvesSchema } from '@/core/videoEdit/codeMaterialAnimation'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialInstanceSchema } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { loadFontLibrary } from '@/platform/fonts'
import { listVideoEditInstances, requireVideoEditInstance, openVideoEditDocument, restoreVideoEditSnapshot, videoEditDomainRevision, withVideoEditCommitBatch, videoEditTransactionBatch } from './videoEditService'
import { videoEditSchemaRef } from './videoEditFields'
import { changedVideoEditFonts } from './videoEditFonts'
import { videoEditCodeElementFrames, videoEditCodeElementRef, VIDEO_EDIT_CODE_ELEMENT } from './videoEditCodeElements'
import { videoEditCodeElementSourceIds } from './videoEditCodeElementSummary'
import { ensureVideoEditCodeParameterMetadata, peekVideoEditCodeProgram, readVideoEditCodeMetadata } from './videoEditCodeState'
import { readVideoEditCodeElementEdit, videoEditCodeElementEffectStates, videoEditCodeElementKind, writeVideoEditCodeElementGroups, type VideoEditCodeElementTarget, type VideoEditCodeElementGroups } from './videoEditCodeElementWrites'

const type = VIDEO_EDIT_CODE_ELEMENT
type Data = Record<string, JsonValue>
const schemas = {
  transform: z.object({ ...codeElementOverrideValuesSchema.shape, curves: codeElementOverrideSchema.shape.curves }).strict(),
  properties: z.object({ values: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema.optional() }).strict(),
  effects: z.object({ effects: codeElementOverrideSchema.shape.effects, addedEffects: codeElementOverrideSchema.shape.addedEffects }).strict(),
}
const descriptions: Record<keyof typeof schemas, string> = {
  transform: '元素的位移 dx/dy（合成像素）、相对缩放 scale/scaleX/scaleY、旋转 rotation（度）、不透明度 opacity 与隐藏 hidden；curves 用源素材时间的关键帧（与片段 element_overrides 同一结构），修剪、变速、倒放不错位。整组替换，写 {} 回到代码给的值。调整层只能改 opacity 和 hidden。',
  properties: '绑定到这个元素的作者参数（observation.parameterKeys，声明见 observation.declarations）：values 为静态值，curves 为源时间关键帧。整组替换，没写的绑定参数回到源码默认值；未绑定的参数用 video_edit.clip.code_parameters 修改。',
  effects: '元素效果链。effects 按代码效果 key 覆盖：enabled:false 关掉代码给的效果，values 改参数，curves 为源时间关键帧；风格件（look:<名称>）只接受旋钮。addedEffects 追加到链末尾：{ key, id（内置效果 ID）, params, curves? }，key 不能与代码效果重名；源码后来用了追加项已占的 key 时，追加项换成 <效果 ID>+N，代码那一项保留原 key。参数按代码值加覆盖整组校验（含调色起点不大于终点这类跨参数约束）。先读 observation.effectStates 的代码值、实际值与 key；整组替换，写 {} 重置全部效果改动。',
}
const fields: ApplicationFieldDefinition<Data, Data>[] = (Object.keys(schemas) as Array<keyof typeof schemas>).map(key => ({
  propertyId: `${type}.${key}`, storeActions: [], read: data => data[key],
  descriptor: { id: `${type}.${key}`, entityType: type, version: 1, title: { transform: '变换', properties: '属性', effects: '效果' }[key], description: descriptions[key],
    value: { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.${key}.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.${key}`) },
  writer: { write: (data, mutation) => { data[key] = schemas[key].parse(mutation.value) as JsonValue } },
}))
fields.push({ propertyId: `${type}.observation`, storeActions: [], read: data => data.observation,
  descriptor: { id: `${type}.observation`, entityType: type, version: 1, title: '元素读回', description: '当前帧的元素读回：visible、missing（源码里已没有此元素）、kind（adjust 为调整层）、绑定参数 parameterKeys/declarations/values、求值后的 transform、effectStates（每项效果的 key、id、代码值 codeValues、实际值 values、被覆盖的参数 overridden、是否追加 added、是否停用、missing 表示代码里已没有这个效果但改动保留），以及 edits：每个改动最后由 user 还是 assistant 在何时修改（毫秒时间戳）。元素当前帧不可见不等于已从源码删除。', value: { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.observation.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.observation`), readOnlyReason: '由源码、正式取帧观察与变换、属性、效果三组写入共同维护；改值请写对应的组。' },
})
const writers = fieldWriterTable(fields)
const revisions = () => ({ video_edit: videoEditDomainRevision() })
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
function resolve(ref: ApplicationRef): VideoEditCodeElementTarget {
  const [projectId, sequenceId, clipId, elementId, extra] = ref.id.split(':').map(decodeURIComponent)
  if (ref.kind !== type || !elementId || extra !== undefined) throw new Error('请使用 list_application_entities 或 selected_code_element.elementRef 返回的完整代码元素引用。')
  const clip = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(clip => clip.id === clipId)
  if (!clip?.code || clip.kind !== 'code') throw new Error('原代码片段已移除，请重新列出元素。')
  return { projectId, sequenceId, clipId, elementId, versionId: clip.code.versionId }
}
/** 后台读写不要求剪辑已打开或代码声明已读入。 */
async function prepare(ref: ApplicationRef, signal?: AbortSignal): Promise<VideoEditCodeElementTarget> {
  const projectId = decodeURIComponent(ref.id.split(':')[0])
  if (!listVideoEditInstances().some(owner => owner.document.id === projectId)) await openVideoEditDocument({ id: projectId }, { focus: false })
  const target = resolve(ref), owner = requireVideoEditInstance(projectId)
  const clip = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips.find(clip => clip.id === target.clipId)!
  await ensureVideoEditCodeParameterMetadata(owner, owner.document, clip.code!.definitionId, clip.code!.versionId, signal)
  return target
}
function dataOf(target: VideoEditCodeElementTarget): Data {
  const current = readVideoEditCodeElementEdit(target)
  const { effects, addedEffects, ...transform } = current.override
  const keys = current.element?.author.parameterKeys ?? current.program.parameters.filter(param => param.layer === target.elementId).map(param => param.key)
  const known = new Set(Object.keys(current.program.bundle.locations.layers)); for (const id of current.entry?.index.byId.keys() ?? []) known.add(id)
  if (!known.has(target.elementId) && !Object.hasOwn(current.clip.elementOverrides ?? {}, target.elementId)) throw new Error(`代码片段里没有元素「${target.elementId}」；请重新列出元素或先取帧观察。`)
  const ids = videoEditCodeElementSourceIds(current.program, current.entry?.index, current.clip.elementOverrides ?? {})
  const parameters = current.clip.code!.parameters, curves = current.clip.code!.curves ?? {}
  const boundCurves = Object.fromEntries(Object.entries(curves).filter(([key]) => keys.includes(key)))
  return {
    transform: json(transform),
    properties: json({ values: Object.fromEntries(Object.entries(parameters).filter(([key]) => keys.includes(key))), ...(Object.keys(boundCurves).length ? { curves: boundCurves } : {}) }),
    effects: json({ ...(effects ? { effects } : {}), ...(addedEffects ? { addedEffects } : {}) }),
    observation: json({ elementId: target.elementId, clipRef: { kind: 'video_edit.clip', id: `${target.projectId}:${target.clipId}` }, visible: Boolean(current.element && current.element.opacity >= .01), missing: !ids.has(target.elementId), kind: videoEditCodeElementKind(current, target.elementId) ?? 'layer',
      parameterKeys: keys, declarations: current.program.parameters.filter(param => keys.includes(param.key)), values: Object.fromEntries(Object.entries(current.parameters).filter(([key]) => keys.includes(key))),
      transform: current.values, effectStates: videoEditCodeElementEffectStates(current), edits: codeElementEdits(current.clip.edits, target.elementId, keys) }),
  }
}
function unavailable(target: VideoEditCodeElementTarget, propertyId: string): string | undefined {
  if (propertyId === `${type}.observation`) return '观察由源码与正式取帧维护；改值请写 transform、properties 或 effects。'
  const current = readVideoEditCodeElementEdit(target)
  // 按源码声明判断调整层，不必等它出现在当前帧的观察里。
  if (propertyId === `${type}.properties` && videoEditCodeElementKind(current, target.elementId) === 'adjust') return '调整层只能修改效果参数与 opacity。'
  const apiVersion = codeMaterialVersion(current.owner.document, current.clip.code!).apiVersion
  if (propertyId === `${type}.effects` && apiVersion < CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION) return `此代码使用作者接口 v${apiVersion}，图层效果从 v${CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION} 起可用；请先用 upgrade_video_edit_code_materials 升级代码素材。`
  return undefined
}
export function createVideoEditCodeElementRegistration(): ApplicationEntityRegistration {
  return {
    entity: { id: type, domain: 'video_edit', version: 1, title: '代码画面元素', description: '代码片段里一个画面元素（作者图层 id）的三组可调属性：变换、属性（绑定的作者参数）、效果。只改覆盖值，源码不动；人和助手共用同一组写入、修改记录与撤销。元素按当前帧求值：先 observe_video_edit_frame 取帧观察或读 video_edit.document.selected_code_element.elementRef，再列出、读取或修改。', refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.clip'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type) },
    properties: fieldDescriptors(fields), schemaDocuments: [...(Object.keys(schemas) as Array<keyof typeof schemas>).map(key => ({ ref: videoEditSchemaRef('property', `${type}.${key}.value`), value: z.toJSONSchema(schemas[key]) as JsonValue, validator: schemas[key] })), { ref: videoEditSchemaRef('property', `${type}.observation.value`), value: { type: 'object' } }],
    provider: { entityType: type,
      async listEntities(request) {
        const all = listVideoEditInstances().flatMap(owner => owner.document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => {
          if (!clip.code || clip.kind !== 'code') return []
          const ids = new Set([...Object.keys(peekVideoEditCodeProgram(owner, clip.code.versionId)?.bundle.locations.layers ?? {}), ...Object.keys(clip.elementOverrides ?? {})])
          for (const id of videoEditCodeElementFrames(owner, sequence.id, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)?.index.byId.keys() ?? []) ids.add(id)
          return [...ids].map(elementId => ({ ...videoEditCodeElementRef({ projectId: owner.document.id, sequenceId: sequence.id, clipId: clip.id, elementId }), label: `${clip.name} / ${elementId}` }))
        })))
        const offset = Math.max(0, Number(request.cursor) || 0)
        return { refs: all.slice(offset, offset + request.limit), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() }
      },
      async readEntity(ref, request) {
        const target = await prepare(ref)
        const selected = request.propertyIds?.length ? fields.filter(field => request.propertyIds!.includes(field.propertyId)) : fields
        return { ref, entityType: type, properties: request.propertyIds?.length === 0 ? {} : fieldReadValues(selected, dataOf(target)), revisions: revisions(), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        const target = await prepare(ref)
        return propertyIds.map(propertyId => {
          if (!fields.some(field => field.propertyId === propertyId)) throw new Error(`未知元素属性 ${propertyId}；可用属性：${fields.map(field => field.propertyId).join('、')}。`)
          const reason = unavailable(target, propertyId)
          return { propertyId, readable: true, writable: !reason, reasons: reason ? [reason] : [], requiredPermissions: ['video_edit:read', ...(reason ? [] : ['video_edit:write'])], revisions: revisions() }
        })
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write']) },
    },
  }
}
/** 嵌入与外部助手的操作记为 assistant；界面直接调用应用能力时记为 user。 */
export function videoEditCodeEditActor(context?: Pick<ApplicationExecutionContext, 'operationOrigin' | 'exposure'>): CodeEditActor {
  return context?.operationOrigin?.actor === 'user' || !context?.operationOrigin && context?.exposure === 'ui' ? 'user' : 'assistant'
}
export class VideoEditCodeElementMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(writers)
  readonly propertyOperations = propertyOperations(writers)
  private readonly receipts = new Map<string, { before: VideoEditDocument; after: VideoEditDocument; ref: ApplicationRef }>()
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const target = await prepare(step.target, context.signal), owner = requireVideoEditInstance(target.projectId), before = owner.document
    const data = dataOf(target)
    await applyWriterTable(writers, data, step.mutations)
    context.signal?.throwIfAborted()
    if (owner.document !== before) throw new Error('剪辑已修改，请重新读回元素。')
    const groups = Object.fromEntries(step.mutations.map(mutation => { const key = mutation.propertyId.slice(type.length + 1); return [key, data[key]] })) as VideoEditCodeElementGroups
    withVideoEditCommitBatch(videoEditTransactionBatch(context, target.projectId), () => writeVideoEditCodeElementGroups(target, groups, videoEditCodeEditActor(context)))
    const after = owner.document
    if (changedVideoEditFonts(before, after, readVideoEditCodeMetadata(owner, before), readVideoEditCodeMetadata(owner, after)).some(use => !GENERIC_FONT_FACES.some(face => face.family === use.font))) await loadFontLibrary(true)
    const undoToken = crypto.randomUUID(); this.receipts.set(undoToken, { before, after, ref: step.target })
    while (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!)
    return { status: 'completed', directRefs: [step.target], undoToken, resultingRevisions: revisions(), evidence: [{ kind: 'entity_state', fact: '代码元素已写入同一剪辑历史，修改记录同步更新。', capturedAt: new Date().toISOString() }] }
  }
  private restore(token: string, compensation: boolean, context?: ApplicationExecutionContext): ApplicationCompletedStepResult {
    const record = this.receipts.get(token); if (!record) throw new Error('元素撤销记录已失效。')
    withVideoEditCommitBatch(videoEditTransactionBatch(context, record.before.id), () => restoreVideoEditSnapshot(record.before.id, record.after, record.before, compensation))
    this.receipts.delete(token)
    return { status: 'completed', directRefs: [record.ref], resultingRevisions: revisions(), evidence: [{ kind: 'entity_state', fact: '已恢复代码元素及修改记录。', capturedAt: new Date().toISOString() }] }
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult, context?: ApplicationExecutionContext) { return result.undoToken ? this.restore(result.undoToken, true, context).evidence : [] }
  async undo(token: string, context?: ApplicationExecutionContext) { return this.restore(token, false, context) }
  forget(token: string): void { this.receipts.delete(token) }
}
