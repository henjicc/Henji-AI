// @vitest-environment jsdom
import '@/tests/canvasProjectFixture'
import '@/tests/imageEditDocumentFixture'
import '@/tests/cameraStageProjectFixture'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { buildExternalCapabilityInventory } from '@/features/application-control/externalCapabilityInventory'
import { listApplicationResources } from '../../electron/main/services/mcp/resources'
import { useProjectStore } from '@/stores/projectStore'
import { requireCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { subscribeHostContext } from '@/features/application-control/hostContext/hostContext'
import { createStoredCameraStageProject } from '@/features/cameraStage/projects/cameraStageProjectService'
import { cameraStageProjectStore } from '@/features/cameraStage/application/cameraStageProjectRuntime'

beforeEach(installHarnessNativeStorage)
afterEach(uninstallHarnessNativeStorage)

it('工程、文档与设置资源目录通过正式注册表读取，后台修改发布变化且不切换页面', async () => {
  const harness = createApplicationHarness()
  await useProjectStore.getState().hydrate()
  const visibleId = await useProjectStore.getState().createProject('编辑 A')
  const backgroundId = await useProjectStore.getState().createProject('后台 B', { attach: false })
  const stage = await createStoredCameraStageProject('后台三维')
  let notifications = 0
  const detach = subscribeHostContext(() => { notifications++ })
  try {
    const dispatcher = { call: (_caller: string, name: string, input: Record<string, unknown> | undefined) => harness.call(name, input) }
    const domains = buildExternalCapabilityInventory().filter(domain => ['canvas', 'camera_stage', 'image_edit', 'image_mark', 'settings'].includes(domain.id))
    let cursor: string | undefined
    const uris: string[] = []
    do {
      const page = await listApplicationResources(dispatcher, 'resource-catalog', domains, cursor, new AbortController().signal)
      uris.push(...page.resources.map(resource => resource.uri))
      cursor = page.nextCursor
    } while (cursor)
    expect(uris.length).toBeGreaterThan(0)
    expect(new Set(uris).size).toBe(uris.length)
    expect(uris.some(uri => uri.startsWith('henji://entity/settings.'))).toBe(true)
    expect(uris).toContain(`henji://entity/canvas.project/${backgroundId}`)
    const beforeCanvas = notifications
    requireCanvasProjectInstance(backgroundId).store.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 })
    expect(notifications).toBeGreaterThan(beforeCanvas)
    const beforeStage = notifications
    cameraStageProjectStore(stage.id).getState().addPrimitive('box')
    expect(notifications).toBeGreaterThan(beforeStage)
    expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
  } finally { detach(); harness.dispose() }
})
