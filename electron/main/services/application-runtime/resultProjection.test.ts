// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { projectApplicationToolResult } from './resultProjection'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import type { ApplicationHostBridge } from './applicationHostBridge'
import { executePiTool } from '../embedded-agent/toolResult'
import { toMcpResult } from '../mcp/resultProjection'

const scopes = { navigation: 1, canvas: 2, generation: 3, toolbox: 4, assets: 5, video_edit: 6 }
const ref = { kind: 'video_edit.document', id: 'document' }
const revisions = { 'video_edit:document': 6 }
const evidence = [{ kind: 'property_value', target: ref, fact: '已改名', data: '名称', capturedAt: new Date(0).toISOString() }]
const receipt = { ok: true, resultingRevision: 9, resultingScopeRevisions: scopes,
  data: { revision: 9, scopeRevisions: scopes, status: 'completed', undoRef: 'undo', transactionRef: 'transaction',
    verification: { verified: true, evidence, unmetConditions: [], checkedAt: new Date(0).toISOString() },
    resultingRevisions: revisions, resultRefs: [ref], effects: [{ entityType: ref.kind, refs: [ref], evidence }], evidence } }

describe('Pi 与 MCP 的公共响应裁剪', () => {
  it('修订号与宿主代次默认不交付，includeDetails 时给全；原始结果不被改写', () => {
    for (const kind of ['canvas.node', 'image_edit.document', 'video_edit.document']) {
      const before = { ok: true, revisionEpoch: 'before-restart', baselineId: 'baseline', data: { revision: 0, scopeRevisions: { [kind.split('.')[0]]: 0 }, ref: { kind, id: 'document' } } }
      const projected = projectApplicationToolResult('read_application_entity', { ref: { kind, id: 'document' } }, before)
      expect(projected).not.toHaveProperty('revision')
      expect(projected).not.toHaveProperty('revisionEpoch')
      expect(projected).toMatchObject({ baselineId: 'baseline' })
      expect(projectApplicationToolResult('read_application_entity', {}, before, { includeDetails: true })).toMatchObject({ revision: 0, revisionEpoch: 'before-restart' })
      expect(before.data).toHaveProperty('revision', 0)
    }
    // 长文本分页续读要靠代次识别宿主重启：修订号重启后可能恰好相同
    const page = { ok: true, revisionEpoch: 'epoch', data: { ref, properties: { 'video_edit.clip.text': '正文' }, revisions, textPage: { propertyId: 'video_edit.clip.text', offset: 0, total: 2, nextOffset: null } } }
    expect(projectApplicationToolResult('read_application_entity', { ref, textPage: { propertyId: 'video_edit.clip.text', offset: 0, limit: 4000 } }, page)).toMatchObject({ revisionEpoch: 'epoch', data: { revisions } })
  })
  it('写入回执只留 undoRef、Effect 与验证结论；内部回执与恢复证据不变', () => {
    const original = structuredClone(receipt)
    const raw = { ok: true, operationId: 'id', executionState: 'completed' as const, result: receipt, recoveryResult: null }
    const projected = projectApplicationToolResult('change_application_entities', { changes: [{ entityType: ref.kind, target: ref }] }, raw)
    expect(projected).not.toHaveProperty('scopeRevisions')
    expect(projected).not.toHaveProperty('recoveryResult')
    expect(projected.result).not.toHaveProperty('resultingRevision')
    // 与 effects 里引用相同的 resultRefs、事务号、写后修订与核对时间都是账本记录，模型用不上
    expect((projected.result as { data: unknown }).data).toEqual({ status: 'completed', undoRef: 'undo', verification: { verified: true }, effects: [{ entityType: ref.kind, refs: [ref] }] })
    expect(receipt).toEqual(original)
    const detailed = projectApplicationToolResult('change_application_entities', {}, raw, { includeDetails: true })
    expect(detailed.scopeRevisions).toEqual(scopes)
    expect((detailed.result as typeof receipt).data).toMatchObject({ transactionRef: 'transaction', resultingRevisions: revisions, verification: { evidence } })
    const otherRef = { kind: 'video_edit.clip', id: 'document:clip' }
    const created = projectApplicationToolResult('change_application_entities', {}, { ...raw, result: { ...receipt, data: { ...receipt.data, resultRefs: [ref, otherRef] } } })
    expect((created.result as typeof receipt).data.resultRefs).toEqual([ref, otherRef])
    const recovered = projectApplicationToolResult('get_application_operation', {}, { ...raw,
      recoveryResult: { ...receipt, resultingRevision: 10, resultingScopeRevisions: { ...scopes, video_edit: 7 },
        data: { ...receipt.data, revision: 10, scopeRevisions: { ...scopes, video_edit: 7 } } } }, { includeDetails: true })
    expect(recovered).toMatchObject({ revision: 10, scopeRevisions: { video_edit: 7 } })
    const failure = { ok: false, error: { code: 'SAVE_FAILED', message: '保存失败', details: { transaction: { recoveryVerification: { evidence }, persistence: { recovery: { replayMutation: false } } } } } }
    expect(projectApplicationToolResult('change_application_entities', {}, failure)).toEqual(failure)
  })

  it('列表保留稳定 refs、分页结束和属性中的空值，只省略对应 items.ref 与空元数据', () => {
    const properties = { name: '', absent: null, ordered: [], visible: false, time: 0 }
    const raw = { ok: true, data: { refs: [ref], items: [{ ref, properties }], nextCursor: null, revisions, revision: 9, scopeRevisions: scopes } }
    const compact = projectApplicationToolResult('list_application_entities', { entityType: ref.kind }, raw)
    expect(compact.data).toEqual({ refs: [ref], items: [{ properties }], nextCursor: null, revisions })
    expect(projectApplicationToolResult('list_application_entities', {}, raw, { includeDetails: true }).data?.items).toEqual(raw.data.items)
    expect(projectApplicationToolResult('list_application_entities', {}, { ok: true, data: { refs: [], items: [], nextCursor: null } }).data).toEqual({ refs: [], nextCursor: null })
  })

  it('整实体读取不列空值属性并给出个数，点名属性与 0、false 原样返回', () => {
    const properties = { 'video_edit.clip.name': '片段', 'video_edit.clip.opacity': 0, 'video_edit.clip.locked': false,
      'video_edit.clip.effects': [], 'video_edit.clip.graphic': null, 'video_edit.clip.edits': '', 'video_edit.clip.overrides': {} }
    const raw = { ok: true, data: { ref, entityType: ref.kind, properties, revisions, capturedAt: new Date(0).toISOString() } }
    expect(projectApplicationToolResult('read_application_entity', { ref }, raw).data).toEqual({ ref, revisions, omittedEmptyProperties: 4,
      properties: { 'video_edit.clip.name': '片段', 'video_edit.clip.opacity': 0, 'video_edit.clip.locked': false } })
    expect(projectApplicationToolResult('read_application_entity', { ref, propertyIds: Object.keys(properties) }, raw).data?.properties).toEqual(properties)
    expect(projectApplicationToolResult('read_application_entity', { ref }, raw, { includeDetails: true }).data).toEqual(raw.data)
    // 转录稿这类大数组不点名时只报体积，点名照常整份返回
    const transcript = Array.from({ length: 2000 }, (_, index) => ({ text: '字', start: index }))
    const long = { ok: true, data: { ...raw.data, properties: { 'video_edit.clip.name': '片段', 'video_edit.sequence.transcript': transcript } } }
    expect(projectApplicationToolResult('read_application_entity', { ref }, long).data).toMatchObject({ properties: { 'video_edit.clip.name': '片段' },
      largeProperties: { 'video_edit.sequence.transcript': { items: 2000, chars: JSON.stringify(transcript).length } } })
    expect(projectApplicationToolResult('read_application_entity', { ref, propertyIds: ['video_edit.sequence.transcript'] }, long).data?.properties).toEqual(long.data.properties)
  })

  it('文档与项目列表只在为 true 时列出标记，按项目列出时不重复项目名', () => {
    const document = { ref: { kind: 'documents.document', id: 'a' }, name: '多轨', kind: 'video_edit', projectId: 'p', projectName: '项目', draft: false, missing: false, external: true, updatedAt: 1 }
    const raw = { ok: true, data: { documents: [document], total: 1 } }
    expect(projectApplicationToolResult('list_documents', { location: 'project', projectId: 'p' }, raw).data?.documents)
      .toEqual([{ ref: document.ref, name: '多轨', kind: 'video_edit', external: true, updatedAt: 1 }])
    expect(projectApplicationToolResult('list_documents', { location: 'any' }, raw).data?.documents)
      .toEqual([{ ref: document.ref, name: '多轨', kind: 'video_edit', projectId: 'p', projectName: '项目', external: true, updatedAt: 1 }])
  })

  it('模型只省略描述噪音，零值范围、空默认值/选项值、价格未知与限制均保留', () => {
    const data = { schemaRef: { id: 'model', digest: 'sha256:repeat' }, nextCursor: null,
      priceEstimate: { amount: null }, inputLimits: { images: { max: 0 } },
      params: [{ id: 'prompt', name: { zh: '提示词', en: '' }, default: '', min: null, max: null },
        { id: 'count', default: null, min: 0, max: 1, options: [{ value: '', label: '' }] }] }
    const compact = projectApplicationToolResult('get_model_schema', {}, { ok: true, data })
    expect(compact.data).toMatchObject({ schemaRef: { id: 'model' }, nextCursor: null, priceEstimate: { amount: null }, inputLimits: { images: { max: 0 } },
      params: [{ default: '', name: { zh: '提示词' } }, { default: null, min: 0, max: 1, options: [{ value: '' }] }] })
    expect(compact.data?.schemaRef).not.toHaveProperty('digest')
    expect((compact.data?.params as object[])[0]).not.toHaveProperty('min')
    expect(projectApplicationToolResult('get_model_schema', {}, { ok: true, data }, { includeDetails: true }).data).toEqual(data)
    expect(projectApplicationToolResult('search_models', {}, { ok: true, data: { catalogVersion: 'catalog', models: [], nextCursor: null } }).data)
      .toEqual({ catalogVersion: 'catalog', models: [], nextCursor: null })
    expect(projectApplicationToolResult('get_model_schema', {}, { ok: true, data: { ...data, params: [] } }).data?.params).toEqual([])
  })

  it('交付选项不进入业务参数/幂等身份；Pi 与 MCP 消费同一结果', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { ref, entityType: ref.kind, capturedAt: new Date(0).toISOString(), properties: { name: '名称' }, revisions, revision: 9, scopeRevisions: scopes } })
    const host = { execute, rendererEpoch: 'epoch', tools: () => [] } as unknown as ApplicationHostBridge
    const dispatcher = new ApplicationToolDispatcher({ assertActive: () => {} }, host)
    const signal = new AbortController().signal
    let observed: unknown
    const compact = await dispatcher.call('caller', 'read_application_entity', { ref }, signal, raw => { observed = raw })
    // 宿主日志拿精简前的结果，交给模型的是精简后的
    expect(observed).toMatchObject({ data: { capturedAt: new Date(0).toISOString(), scopeRevisions: scopes } })
    expect(compact.data).not.toHaveProperty('capturedAt')
    const detailed = await dispatcher.call('caller', 'read_application_entity', { ref, includeDetails: true }, signal)
    expect(execute.mock.calls.map(call => call[2])).toEqual([{ ref }, { ref }])
    expect(compact).not.toHaveProperty('scopeRevisions')
    expect(detailed.scopeRevisions).toEqual(scopes)
    const pi = await executePiTool({ id: 'tool', name: 'read_application_entity', args: { ref }, vision: false, signal }, async () => compact)
    expect(pi.content).toEqual(toMcpResult(compact).content)
    const invalid = await dispatcher.call('caller', 'read_application_entity', { ref, includeDetails: 'yes' }, signal)
    expect(invalid.ok).toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
