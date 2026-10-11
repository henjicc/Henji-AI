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
  it('只交付一份相关修订和验证结论，内部回执与恢复证据不变', () => {
    const original = structuredClone(receipt)
    const raw = { ok: true, operationId: 'id', executionState: 'completed' as const, result: receipt, recoveryResult: null }
    const projected = projectApplicationToolResult('change_application_entities', { changes: [{ entityType: ref.kind, target: ref }] }, raw)
    expect(projected).toMatchObject({ revision: 9, scopeRevisions: { video_edit: 6 }, result: { data: { undoRef: 'undo', resultingRevisions: revisions, verification: { verified: true } } } })
    expect(projected).not.toHaveProperty('recoveryResult')
    expect(projected.result).not.toHaveProperty('resultingRevision')
    expect((projected.result as typeof receipt).data).not.toHaveProperty('evidence')
    expect((projected.result as typeof receipt).data.verification).not.toHaveProperty('evidence')
    expect(receipt).toEqual(original)
    const detailed = projectApplicationToolResult('change_application_entities', {}, raw, { includeRevisions: true, includeEvidence: true })
    expect(detailed.scopeRevisions).toEqual(scopes)
    expect((detailed.result as typeof receipt).data.verification.evidence).toEqual(evidence)
    const recovered = projectApplicationToolResult('get_application_operation', {}, { ...raw,
      recoveryResult: { ...receipt, resultingRevision: 10, resultingScopeRevisions: { ...scopes, video_edit: 7 },
        data: { ...receipt.data, revision: 10, scopeRevisions: { ...scopes, video_edit: 7 } } } })
    expect(recovered).toMatchObject({ revision: 10, scopeRevisions: { video_edit: 7 } })
    const failure = { ok: false, error: { code: 'SAVE_FAILED', message: '保存失败', details: { transaction: { recoveryVerification: { evidence }, persistence: { recovery: { replayMutation: false } } } } } }
    expect(projectApplicationToolResult('change_application_entities', {}, failure)).toEqual(failure)
  })

  it('列表保留稳定 refs、分页结束和属性中的空值，只省略对应 items.ref 与空元数据', () => {
    const properties = { name: '', absent: null, ordered: [], visible: false, time: 0 }
    const raw = { ok: true, data: { refs: [ref], items: [{ ref, properties }], nextCursor: null, revisions, revision: 9, scopeRevisions: scopes } }
    const compact = projectApplicationToolResult('list_application_entities', { entityType: ref.kind }, raw)
    expect(compact.data).toEqual({ refs: [ref], items: [{ properties }], nextCursor: null, revisions })
    expect(compact.scopeRevisions).toEqual({ video_edit: 6 })
    expect(projectApplicationToolResult('list_application_entities', {}, raw, { includeDetails: true }).data?.items).toEqual(raw.data.items)
    expect(projectApplicationToolResult('list_application_entities', {}, { ok: true, data: { refs: [], items: [], nextCursor: null } }).data).toEqual({ refs: [], nextCursor: null })
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
    const execute = vi.fn().mockResolvedValue({ ok: true, data: { ref, properties: { name: '名称' }, revisions, revision: 9, scopeRevisions: scopes } })
    const host = { execute, rendererEpoch: 'epoch' } as unknown as ApplicationHostBridge
    const dispatcher = new ApplicationToolDispatcher({ assertActive: () => {}, access: () => ({ allowWrites: false, allowDestructive: false, allowPaid: false }) }, host)
    const signal = new AbortController().signal
    const compact = await dispatcher.call('caller', 'read_application_entity', { ref }, signal)
    const detailed = await dispatcher.call('caller', 'read_application_entity', { ref, includeRevisions: true }, signal)
    expect(execute.mock.calls.map(call => call[2])).toEqual([{ ref }, { ref }])
    expect(compact.scopeRevisions).toEqual({ video_edit: 6 })
    expect(detailed.scopeRevisions).toEqual(scopes)
    const pi = await executePiTool({ id: 'tool', name: 'read_application_entity', args: { ref }, vision: false, signal }, async () => compact)
    expect(pi.content).toEqual(toMcpResult(compact).content)
    const invalid = await dispatcher.call('caller', 'read_application_entity', { ref, includeEvidence: 'yes' }, signal)
    expect(invalid.ok).toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
