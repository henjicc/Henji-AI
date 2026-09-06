// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { runAssistantHarness, type HarnessModelStep } from './assistantRuntimeHarness'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { getProjectRecord } from '@/commands/projectState'

let dispose: (() => void) | undefined
beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { dispose?.(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
function script(id: string, source: string): HarnessModelStep {
  return { actions: [{ type: 'tool_call', toolCall: { toolCallId: id, toolName: 'run_henji_script', dynamic: false,
    input: { language: 'henji-ts/v1', summary: id, source } } }] }
}

it('正式助手图片编辑保存拒绝后返回恢复事实，并只保存原修改一次', async () => {
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'harness-durable-image' })
  document.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const bus = new ImageEditCommandBusV3(document)
  dispose = registerPersistedImageEditTestSession('harness-durable-session', bus, new ImageEditorV3CommandRepository())
  const saves = vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument').mockRejectedValueOnce(new Error('readonly storage'))
  const result = await runAssistantHarness({ goal: '把图片图层透明度改为 0.42，保存失败时只重试保存，不重复编辑。', intent: 'image_edit',
    steps: [
      { actions: [{ type: 'tool_call', toolCall: { toolCallId: 'discover-durable', toolName: 'discover_application_capabilities', dynamic: false,
        input: { queries: ['修改图片图层', '重试保存图片编辑文档'], domains: ['image_edit'],
          entityTypes: ['image_edit.document', 'image_edit.layer'], writes: true } } }] },
      script('edit-once', "const layers = await app.entities.list('image_edit.layer'); await app.entities.update(layers.refs[0], { 'image_edit.layer.opacity': 0.42 });"),
      script('save-only', "await app.action('retry_image_edit_document_save', { documentRef: { kind: 'image_edit.document', id: 'v3:harness-durable-image' } });"),
      { actions: [{ type: 'text', value: '图片修改已保存，没有重复编辑。' }] },
    ],
  })
  const calls = result.toolCalls.filter((call) => call.toolName === 'run_henji_script')
  expect(calls[0]?.ok, JSON.stringify(result.toolCalls)).toBe(false)
  expect(calls[0]?.errorMessage).toContain('内容已保留')
  expect(calls[0]?.errorMessage).toContain('保存未确认')
  expect(calls[0]?.errorMessage).toContain('不要重复')
  expect(calls[1]?.ok, JSON.stringify(result.toolCalls)).toBe(true)
  const saved = readHarnessImageEditDocument(document.id)!
  expect(saved.document.revision).toBe(1)
  expect(saved.document.layers[0].opacity).toBe(0.42)
  expect(saved.history?.undo).toHaveLength(1)
  expect(bus.getPersistenceSnapshot().history).toEqual(saved.history)
  expect(saves).toHaveBeenCalledTimes(2)
})

it('附着图片通过正式 Gateway 修改后，文档与画布节点持久化事实和级联回执一致', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  dispose = fixture.dispose
  const result = await runAssistantHarness({ goal: '调整画布多图层文档图层透明度并保存对应节点预览。', intent: 'image_edit',
    steps: [
      { actions: [{ type: 'tool_call', toolCall: { toolCallId: 'discover-attached', toolName: 'discover_application_capabilities', dynamic: false,
        input: { queries: ['修改图片图层', '画布图片文档'], domains: ['image_edit', 'canvas'],
          entityTypes: ['image_edit.document', 'image_edit.layer', 'canvas.node'], writes: true } } }] },
      script('attached-edit', "const layers = await app.entities.list('image_edit.layer'); await app.entities.update(layers.refs[0], { 'image_edit.layer.opacity': 0.42 });"),
      { actions: [{ type: 'text', value: '文档和节点预览均已保存。' }] },
    ],
  })
  const call = result.toolCalls.find((item) => item.toolName === 'run_henji_script')
  expect(call?.ok, JSON.stringify(result.toolCalls)).toBe(true)
  const saved = readHarnessImageEditDocument(fixture.document.id)!
  const nodes = JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)
  expect(saved.document.layers[0].opacity).toBe(0.42)
  expect(nodes[0].data.imageEditSession.revision).toBe(saved.document.revision)
  expect(nodes[0].data.imageEditSession.previewRef).toBe(saved.previewRef)
  expect(fixture.queue.getReference().previewRef).toBe(saved.previewRef)
  expect(fixture.materialize).toHaveBeenCalledTimes(1)
  expect(result.state.executionOutcome.effects.some((effect) => effect.effect === 'update'
    && effect.targetRefs.some((ref) => ref.kind === 'canvas.node' && ref.id === `${fixture.projectId}:attached-node`)),
  JSON.stringify(result.state.executionOutcome.effects)).toBe(true)
})
