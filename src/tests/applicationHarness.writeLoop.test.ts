import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
// @vitest-environment jsdom
// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { ApplicationMutationExecutor, ApplicationRef } from '@/core/application-control';
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry';
import { createEmptyImageEditDocument, imageEditDocumentToMarkDoc } from '@/core/imageEdit';
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus';
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3';
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore';
import { BLACK_HEX } from '@/core/theme/colorTokens';
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession';
import { loadRealModelsIntoRegistry } from './loadRealModels';
import { harnessDocumentStore, installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from './harnessNativeStorage';
import { createApplicationHarness } from './applicationHarness';
import { closeVideoEditProject, createVideoEditProject } from '@/features/videoEdit/application/videoEditService';
import { savedVideoEdit } from '@/features/videoEdit/application/videoEditDocumentTestKit';

beforeAll(async () => { installHarnessNativeStorage(); await loadRealModelsIntoRegistry() })
afterAll(() => uninstallHarnessNativeStorage())

it('所有已登记写域均经公共授权入口修改、正式读回并核对持久化', async () => {
  const app = createApplicationHarness()
  const originalContrast = useSettingsStore.getState().themeSelection.contrast
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'application-write-loop' })
  document.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const bus = new ImageEditCommandBusV3(document)
  const dispose = registerPersistedImageEditTestSession('application-write-loop', bus, new ImageEditorV3CommandRepository())
  useImageEditSessionStore.getState().ensureSession('application-mark-loop', createEmptyImageEditDocument())
  try {
    setCanvasTestProjectState({ currentProject: null, currentProjectId: null })
    // 画布是通用文档（3.4）：用 create_document 新建，canvas.project 的 id 就是文档 ID；写域以节点标题验证
    const canvas = await app.requireResult('create_document', { kind: 'canvas', name: '公共画布回环' })
    const canvasDocumentId = (canvas.resultRef as ApplicationRef).id
    const canvasNode = await app.requireResult('change_application_entities', { summary: '公共画布节点', changes: [{
      kind: 'create_items', parent: { kind: 'canvas.project', id: canvasDocumentId }, entityType: 'canvas.node',
      items: [{ properties: { 'canvas.node.node_type': 'textAnnotationNode' } }],
    }] })
    const canvasNodeRef = (canvasNode.resultRefs as ApplicationRef[])[0]
    // 镜头参考是通用文档（3.2）：用通用 create_document 新建，内容实体的 id 就是文档 ID
    const camera = await app.requireResult('create_document', { kind: 'camera_stage', name: '公共三维回环' })
    const cameraDocumentId = (camera.resultRef as ApplicationRef).id
    const library = await app.requireResult('change_application_entities', { summary: '创建素材集合', changes: [{
      kind: 'create_items', entityType: 'asset.library', parent: { kind: 'asset.catalog', id: 'default' },
      items: [{ properties: { 'asset.library.name': '公共素材回环' } }],
    }] })
    registerHarnessAudioEditProject({
      id: 'audio-loop', name: '公共口播回环', referenceScript: '', transcript: [], suggestions: [], vstEnabled: false,
      source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 48_000, sampleRate: 48_000, channels: 1 },
      createdAt: 1, updatedAt: 1, revision: 1,
    })
    // 剪辑工程保存在用户选择的本地文件；这里只替换文件 I/O 边界。
    const video = await createVideoEditProject()
    // 作品文档（存储底座 2.5）：只替换 henjiNative.documents 背后的文件夹
    const documentMeta = harnessDocumentStore().seed({ kind: 'canvas', name: '公共文档回环', content: { nodes: [], edges: [] } })
    const first = async (entityType: string): Promise<ApplicationRef> => {
      const result = await app.requireResult('list_application_entities', { entityType })
      const refs = result.refs as ApplicationRef[]
      expect(refs.length, entityType).toBeGreaterThan(0)
      return refs[0]
    }
    const loops = [
      { domain: 'settings', ref: { kind: 'settings.registry', id: 'singleton' }, property: 'interface.theme_contrast', value: 'strong' },
      { domain: 'generation', ref: { kind: 'generation.draft', id: 'singleton' }, property: 'generation.draft.prompt_text', value: '公共草稿回环' },
      { domain: 'canvas', ref: canvasNodeRef, property: 'canvas.node.display_name', value: '公共画布节点已改名' },
      { domain: 'camera_stage', ref: { kind: 'camera_stage.scene', id: cameraDocumentId }, property: 'camera_stage.scene.sky_color', value: BLACK_HEX },
      { domain: 'models', ref: await first('generation.model'), property: 'generation.model.hidden', value: true },
      { domain: 'image_mark', ref: await first('image_mark.document'), property: 'image_mark.document.orientation_rotate', value: '90' },
      { domain: 'image_edit', ref: { kind: 'image_edit.layer', id: `v3:${document.id}:effect` }, property: 'image_edit.layer.opacity', value: 0.42 },
      { domain: 'assets', ref: (library.resultRefs as ApplicationRef[])[0], property: 'asset.library.name', value: '公共素材已改名' },
      // 口播名就是文件名（3.3，改名走 documents.document.name）；口播写域以参考稿验证内容写入与持久化
      { domain: 'audio_edit', ref: { kind: 'audio_edit.project', id: 'audio-loop' }, property: 'audio_edit.project.reference_script', value: '公共口播参考稿' },
      // 剪辑名就是文件名（3.1，改名走 documents.document.name）；剪辑写域以序列名验证内容写入与持久化
      { domain: 'video_edit', ref: { kind: 'video_edit.sequence', id: `${video.document.id}:${video.activeSequenceId}` }, property: 'video_edit.sequence.name', value: '公共剪辑已改名' },
      { domain: 'documents', ref: { kind: 'documents.document', id: documentMeta.id }, property: 'documents.document.name', value: '公共文档已改名' },
    ]
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine() as unknown as {
      mutationExecutors: Map<string, ApplicationMutationExecutor>; collectionExecutors: Map<string, unknown>
    }
    const writable = new Set([...engine.mutationExecutors.keys(), ...engine.collectionExecutors.keys()])
    const description = registry.describe({}, { exposure: 'local_adapter',
      permissions: new Set(registry.listDeclaredPropertyPermissions()), acceptedDataClasses: new Set(['C0', 'C1']) })
    const domains = [...new Set(description.entities.filter(entity => writable.has(entity.id)).map(entity => entity.domain))]
    // 共享记忆位于主进程；其写入/读回由 sharedMemoryReflection.test 与原生 memory-store.test 覆盖。
    expect(domains).toContain('memory')
    expect(domains.length).toBeGreaterThanOrEqual(5)
    expect(domains.filter(domain => domain !== 'memory' && !loops.some(loop => loop.domain === domain))).toEqual([])
    for (const loop of loops) {
      const result = await app.change(loop.ref, { [loop.property]: loop.value })
      expect(result.ok, `${loop.domain}: ${JSON.stringify(result)}`).toBe(true)
      const after = await app.read(loop.ref, [loop.property])
      expect((after.properties as Record<string, unknown>)[loop.property], loop.domain).toEqual(loop.value)
    }
    expect(useSettingsStore.getState().themeSelection.contrast).toBe('strong')
    expect(bus.getSnapshot().document.layers[0].opacity).toBe(0.42)
    expect(imageEditDocumentToMarkDoc(useImageEditSessionStore.getState().sessions['application-mark-loop'].document).orientation.rotate).toBe(90)
    const canvasContent = harnessDocumentStore().stored(canvasDocumentId)?.content as { nodes: Array<{ data: { displayName?: string } }> }
    expect(canvasContent.nodes[0].data.displayName).toBe('公共画布节点已改名')
    const cameraContent = harnessDocumentStore().stored(cameraDocumentId)?.content as { sceneSettings: { sky: { color: string } } }
    expect(cameraContent.sceneSettings.sky.color).toBe(BLACK_HEX)
    // 后台写入不切换界面上的三维场景
    expect(useCameraStageStore.getState().currentProjectId).not.toBe(cameraDocumentId)
    expect(savedVideoEdit(video).sequences[0].name).toBe('公共剪辑已改名')
    expect((harnessDocumentStore().stored('audio-loop')?.content as { referenceScript: string }).referenceScript).toBe('公共口播参考稿')
    expect(harnessDocumentStore().stored(documentMeta.id)?.meta.name).toBe('公共文档已改名')
    await closeVideoEditProject(video.document.id)
  } finally { vi.restoreAllMocks(); dispose(); app.dispose(); useSettingsStore.getState().setThemeContrast(originalContrast) }
})
