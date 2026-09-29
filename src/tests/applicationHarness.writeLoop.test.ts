import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
// @vitest-environment jsdom
// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ApplicationMutationExecutor, ApplicationRef } from '@/core/application-control';
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry';
import { createEmptyImageEditDocument, imageEditDocumentToMarkDoc } from '@/core/imageEdit';
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus';
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3';
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore';
import { getPlatform } from '@/platform/runtime';
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession';
import { loadRealModelsIntoRegistry } from './loadRealModels';
import { installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from './harnessNativeStorage';
import { createApplicationHarness } from './applicationHarness';

beforeAll(async () => { installHarnessNativeStorage(); await loadRealModelsIntoRegistry() })
afterAll(() => uninstallHarnessNativeStorage())

it('所有已登记写域均经公共授权入口修改、正式读回并核对持久化', async () => {
  const app = createApplicationHarness()
  const originalTone = useSettingsStore.getState().themeTonePreset
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'application-write-loop' })
  document.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const bus = new ImageEditCommandBusV3(document)
  const dispose = registerPersistedImageEditTestSession('application-write-loop', bus, new ImageEditorV3CommandRepository())
  useImageEditSessionStore.getState().ensureSession('application-mark-loop', createEmptyImageEditDocument())
  try {
    setCanvasTestProjectState({ projects: [], currentProject: null, currentProjectId: null, isHydrated: true })
    const canvas = await app.requireResult('create_canvas_project', { name: '公共画布回环' })
    const camera = await app.requireResult('create_camera_stage_project', { name: '公共三维回环' })
    const library = await app.requireResult('change_application_entities', { summary: '创建素材集合', changes: [{
      kind: 'create_items', entityType: 'asset.library', parent: { kind: 'asset.catalog', id: 'default' },
      items: [{ properties: { 'asset.library.name': '公共素材回环' } }],
    }] })
    registerHarnessAudioEditProject({
      id: 'audio-loop', name: '公共口播回环', referenceScript: '', transcript: [], suggestions: [], vstEnabled: false,
      source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 48_000, sampleRate: 48_000, channels: 1 },
      createdAt: 1, updatedAt: 1, revision: 1,
    })
    const first = async (entityType: string): Promise<ApplicationRef> => {
      const result = await app.requireResult('list_application_entities', { entityType })
      const refs = result.refs as ApplicationRef[]
      expect(refs.length, entityType).toBeGreaterThan(0)
      return refs[0]
    }
    const loops = [
      { domain: 'settings', ref: { kind: 'settings.registry', id: 'singleton' }, property: 'interface.theme_tone', value: 'cool' },
      { domain: 'generation', ref: { kind: 'generation.draft', id: 'singleton' }, property: 'generation.draft.prompt_text', value: '公共草稿回环' },
      { domain: 'canvas', ref: { kind: 'canvas.project', id: String(canvas.projectId) }, property: 'canvas.project.name', value: '公共画布已改名' },
      { domain: 'camera_stage', ref: { kind: 'camera_stage.project', id: String(camera.projectId) }, property: 'camera_stage.project.name', value: '公共三维已改名' },
      { domain: 'models', ref: await first('generation.model'), property: 'generation.model.hidden', value: true },
      { domain: 'image_mark', ref: await first('image_mark.document'), property: 'image_mark.document.orientation_rotate', value: '90' },
      { domain: 'image_edit', ref: { kind: 'image_edit.layer', id: `v3:${document.id}:effect` }, property: 'image_edit.layer.opacity', value: 0.42 },
      { domain: 'assets', ref: (library.resultRefs as ApplicationRef[])[0], property: 'asset.library.name', value: '公共素材已改名' },
      { domain: 'audio_edit', ref: { kind: 'audio_edit.project', id: 'audio-loop' }, property: 'audio_edit.project.name', value: '公共口播已改名' },
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
    expect(useSettingsStore.getState().themeTonePreset).toBe('cool')
    expect(bus.getSnapshot().document.layers[0].opacity).toBe(0.42)
    expect(imageEditDocumentToMarkDoc(useImageEditSessionStore.getState().sessions['application-mark-loop'].document).orientation.rotate).toBe(90)
    expect((await getPlatform().storyboardProjects.listProjectSummaries()).map(project => project.name)).toContain('公共画布已改名')
    expect((await getPlatform().cameraStageProjects.listProjectSummaries()).map(project => project.name)).toContain('公共三维已改名')
    expect(useCameraStageStore.getState().currentProjectName).not.toBe('公共三维已改名')
  } finally { dispose(); app.dispose(); useSettingsStore.getState().setThemeTonePreset(originalTone) }
})
