// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { buildAssistantHarnessRuntime, runAssistantHarness } from './assistantRuntimeHarness'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { getProjectRecord } from '@/commands/projectState'
import { applicationTransactionFailureFactsSchema } from '@/core/assistant/applicationTransactionFailureFacts'

const cleanup: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { cleanup.splice(0).reverse().forEach((dispose) => dispose()); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('两个独立正式 Gateway 的 layer/group 交叉 scope 修改共享锁，存储确认不重叠', async () => {
  const documents = ['one', 'two'].map((id) => createImageEditDocumentV3({ width: 8, height: 8, documentId: `gateway-concurrency-${id}` }))
  documents[0].layers = [createImageEditEffectLayerV3('layer', '原图层', 'image.gaussian-blur-v2', { radius: 8 })]
  documents[1].layers = [createImageEditGroupLayerV3('group', '原组')]
  const buses = documents.map((document) => new ImageEditCommandBusV3(document))
  buses.forEach((bus, index) => cleanup.push(registerPersistedImageEditTestSession(`gateway-concurrent-${index}`, bus, new ImageEditorV3CommandRepository())))
  let active = 0, peak = 0
  const original = window.henjiNative!.imageEditorV3.saveDocument
  vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument').mockImplementation(async (input) => {
    active += 1; peak = Math.max(peak, active)
    try { await new Promise((resolve) => setTimeout(resolve, 30)); return await original(input) }
    finally { active -= 1 }
  })
  const runtimes = [buildAssistantHarnessRuntime({ goal: '并发图层', steps: [] }), buildAssistantHarnessRuntime({ goal: '并发组', steps: [] })]
  runtimes.forEach((runtime) => cleanup.push(runtime.dispose))
  const initial = runtimes.map((runtime) => runtime.getHostContext().scopeRevisions.image_edit)
  expect(initial[0]).toBe(initial[1])
  const results = await Promise.all(runtimes.map((runtime, index) => {
    const type = index === 0 ? 'layer' : 'group'
    return runtime.gateway.execute({ runId: `concurrent-${index}`, threadId: `concurrent-${index}`, toolCallId: `concurrent-${index}`,
      toolName: 'change_application_entities', approvalMode: 'full_access', explicitUserIntent: true,
      signal: new AbortController().signal, expectedRevisions: runtime.getHostContext().scopeRevisions,
      input: { summary: '不同实体共享同一个并发作用域', changes: [{ kind: 'set_properties', entityType: `image_edit.${type}`,
        target: { kind: `image_edit.${type}`, id: `v3:${documents[index].id}:${type}` }, properties: { [`image_edit.${type}.name`]: `已修改${index}` } }] } })
  }))
  expect(results.map((result) => result.status)).toEqual(['completed', 'completed'])
  expect(peak).toBe(1)
  documents.forEach((document, index) => {
    const saved = readHarnessImageEditDocument(document.id)!
    expect(saved.document.layers[0].name).toBe(`已修改${index}`)
    expect(saved.document.revision).toBe(1)
    expect(saved.history?.undo).toHaveLength(1)
  })
})

it('附着图片 name trim 后正式脚本保留双域事实和撤销，仍为 partial 而非假成功', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  cleanup.push(fixture.dispose)
  const result = await runAssistantHarness({ goal: '将图片图层重命名，报告实际修改但不要重复执行。', intent: 'image_edit', steps: [
    { actions: [{ type: 'tool_call', toolCall: { toolCallId: 'discover-partial', toolName: 'discover_application_capabilities', dynamic: false,
      input: { queries: ['修改图片图层'], domains: ['image_edit', 'canvas'], entityTypes: ['image_edit.layer', 'canvas.node'], writes: true } } }] },
    { actions: [{ type: 'tool_call', toolCall: { toolCallId: 'trim-partial', toolName: 'run_henji_script', dynamic: false,
      input: { language: 'henji-ts/v1', summary: '修改图层名称', source: "const layers = await app.entities.list('image_edit.layer'); await app.entities.update(layers.refs[0], { 'image_edit.layer.name': '  已修改  ' });" } } }] },
    { actions: [{ type: 'text', value: '修改已经保存，但完整验证未通过；没有重复修改。' }] },
  ] })
  const event = result.events.find((entry) => entry.type === 'ToolFailed' && entry.toolName === 'run_henji_script')
  if (event?.type !== 'ToolFailed') throw new Error(JSON.stringify(result.toolCalls))
  const facts = applicationTransactionFailureFactsSchema.parse(event.error.transaction)
  expect(facts).toMatchObject({ code: 'VERIFICATION_FAILED', replayMutation: false, undoRef: expect.any(String),
    partial: { completedStepIndexes: [0], uncompensatedStepIndexes: [0] },
    currentRevisions: { image_edit: expect.any(Number), canvas: expect.any(Number) } })
  expect(facts.effects?.map((effect) => effect.entityType)).toEqual(expect.arrayContaining(['image_edit.layer', 'canvas.node']))
  expect(event.error.message).toContain('不要重复')
  // 任务级 seal 只记录已发生事实，并不把失败操作变成成功；保留意见必须保留。
  expect(result.state.executionOutcome.facts).toMatchObject({ completion: 'partial', verificationStatus: 'failed' })
  expect(result.state.executionOutcome.facts?.unresolved.length).toBeGreaterThan(0)
  const changed = result.state.executionOutcome.effects.filter((effect) => effect.effect === 'update')
  expect(changed.map((effect) => effect.entityTypes[0])).toEqual(expect.arrayContaining(['image_edit.layer', 'canvas.node']))
  expect(changed.every((effect) => !effect.verified)).toBe(true)
  const saved = readHarnessImageEditDocument(fixture.document.id)!
  expect(saved.document.layers[0].name).toBe('已修改')
  expect(saved.document.revision).toBe(1)
  expect(saved.history?.undo).toHaveLength(1)
  const nodes = JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)
  expect(nodes[0].data.imageEditSession.revision).toBe(saved.document.revision)
  expect(nodes[0].data.imageEditSession.previewRef).toBe(saved.previewRef)
  expect(fixture.materialize).toHaveBeenCalledTimes(1)
})
