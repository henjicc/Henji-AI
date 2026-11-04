// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import '@/tests/cameraStageProjectFixture'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { documentKindRegistry } from '@/core/documents/kinds'
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry'
import { getHostScopeRevisions } from '@/features/application-control/hostContext/hostContext'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { sceneToDocumentContent } from '../domain/sceneSerialization'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, setCameraStageDocumentRegistryForTests } from './cameraStageProjectRuntime'

/*
 * 写入前就被拒绝的调用必须报“未执行”：否则主进程把它记成结果未知，挡住重试并弹窗请用户核对。
 * 反过来，报“未执行”时场景必须真的没变，否则重试会叠出重复内容。
 * 经正式能力入口与真实事务引擎执行，覆盖引擎内的前置拒绝、适配器自己的前置检查与写入后核对三条路径。
 */
async function openScene(id: string) {
  const commands = new FakeDocumentCommands()
  setCameraStageDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  commands.seed({ kind: 'camera_stage', id, name: id, content: structuredClone(sceneToDocumentContent(createDefaultCameraStageSceneSnapshot())) })
  await ensureCameraStageProjectRuntime(id)
  return { commands, before: structuredClone(cameraStageProjectStore(id).getState().objects) }
}

function invoke(id: string, input: Record<string, unknown>) {
  return executeApplicationCapabilityResult({ id, version: BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!.version,
    input, expectedRevisions: { camera_stage: getHostScopeRevisions().camera_stage } },
  { signal: new AbortController().signal, requestId: `camera-stage-${id}` })
}

it.each([
  ['generate_camera_stage_set', { layout: { preset: 'city', density: 0 } }, 'STAGE_SET_EMPTY'],
  ['generate_camera_stage_set', { layout: { preset: 'city' }, replaceSetId: 'missing' }, 'STAGE_SET_NOT_FOUND'],
  ['place_camera_stage_object', { objectType: 'primitive', primitiveKind: 'box', reusePolicy: 'require_new', placement: { mode: 'beside', targetObjectId: 'missing' } }, 'TARGET_OBJECT_NOT_FOUND'],
  ['update_camera_stage_object', { objectId: 'missing', changes: { name: '新名字' } }, 'missing'],
  ['delete_camera_stage_object', { objectId: 'missing' }, 'missing'],
  ['duplicate_camera_stage_object', { objectId: 'missing' }, 'missing'],
] as const)('%s 写入前被拒绝（%j）时报告未执行', async (id, input, reason) => {
  const { commands, before } = await openScene('reject-doc')
  const result = await invoke(id, { documentId: 'reject-doc', ...input })
  expect(result).toMatchObject({ ok: false, error: { recoverable: true, details: { execution: { notExecuted: true } } } })
  if (!result.ok) expect(result.error.message).toContain(reason)
  expect(cameraStageProjectStore('reject-doc').getState().objects).toEqual(before)
  expect(commands.writes).toBe(0)
})

it('写入后存盘失败时先恢复到写入前，再报告未执行', async () => {
  const { commands, before } = await openScene('save-doc')
  const [target] = before
  commands.failSaves = 1
  const result = await invoke('update_camera_stage_object', { documentId: 'save-doc', objectId: target.id, changes: { name: '存盘失败的新名字' } })
  expect(result).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
  expect(cameraStageProjectStore('save-doc').getState().objects).toEqual(before)
})

it('写入后核对出错时先恢复到写入前，再报告未执行', async () => {
  const { before } = await openScene('verify-doc')
  const generate = cameraStageApplicationService.generateSet.bind(cameraStageApplicationService)
  const read = cameraStageApplicationService.readSnapshot.bind(cameraStageApplicationService)
  let generated = false
  vi.spyOn(cameraStageApplicationService, 'generateSet').mockImplementation(async (input) => { const result = await generate(input); generated = true; return result })
  vi.spyOn(cameraStageApplicationService, 'readSnapshot').mockImplementation(async (id) => { if (generated) throw new Error('读回失败'); return read(id) })
  try {
    const result = await invoke('generate_camera_stage_set', { documentId: 'verify-doc', layout: { preset: 'street', seed: 1 } })
    expect(generated).toBe(true)
    expect(result).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect(cameraStageProjectStore('verify-doc').getState().objects).toEqual(before)
  } finally { vi.restoreAllMocks() }
})
