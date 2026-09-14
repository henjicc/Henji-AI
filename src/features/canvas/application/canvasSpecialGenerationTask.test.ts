// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { GenerationService } from '@/core/services/GenerationService'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import * as imageCommands from '@/commands/image'
import { getPlatform } from '@/platform/runtime'
import * as documentAdapter from './multiLayerDocumentNodeGenerationAdapter'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { DEFAULT_LOCAL_REDRAW_SETTINGS } from '../capabilities/elementEditPolicy'
import { readCanvasGenerationNodeProfile } from './canvasGenerationNodeProfile'
import { createGenerationNodeExecutor } from './generationNodeExecutor'
import { registerCanvasNodeExecutor, resetCanvasExecutionServiceForTests, runCanvasNode } from './canvasExecutionService'
import { prepareCanvasNodeGeneration, submitCanvasNodeGeneration, getCanvasGenerationTask, cancelCanvasGenerationTask } from './canvasGenerationTaskService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'

// 仅供应商、像素与 V3 文档 I/O 使用替身，任务、执行器和原项目保存走正式服务。
vi.mock('./imageData', async original => ({
  ...await original<typeof import('./imageData')>(),
  persistImageLocally: vi.fn(async (url: string) => url),
  prepareNodeImage: vi.fn(async (url: string) => ({ imageUrl: url, previewImageUrl: url, aspectRatio: '1:1', createdFilePaths: [] })),
}))
const records = new Map<string, HistoryRecord>()
let projectId: string
beforeAll(async () => { await loadRealModelsIntoRegistry() })
beforeEach(async () => {
  records.clear()
  installHarnessNativeStorage()
  resetCanvasExecutionServiceForTests()
  await useProjectStore.getState().hydrate()
  projectId = await useProjectStore.getState().createProject('特殊生成原项目')
  useSettingsStore.setState({ providerKeyStatus: { ...useSettingsStore.getState().providerKeyStatus, apimart: true, volcengine: true } })
  vi.spyOn(GenerationService.getInstance(), 'getProgressEstimate').mockResolvedValue(null)
  vi.spyOn(databaseService, 'init').mockResolvedValue()
  vi.spyOn(databaseService, 'getHistoryById').mockImplementation(async id => records.get(id) ?? null)
  vi.spyOn(databaseService, 'insertHistory').mockImplementation(async row => { records.set(row.id, { ...row, createdAt: 'now', updatedAt: 'now' }) })
  vi.spyOn(databaseService, 'updateHistory').mockImplementation(async (id, patch) => { Object.assign(records.get(id)!, patch) })
  vi.spyOn(imageCommands, 'readImageInfo').mockImplementation(async source => ({ source, width: 8, height: 8, hasAlpha: true,
    fileName: null, extension: 'png', orientation: null, fileSizeBytes: 100, createdAt: null, modifiedAt: null }))
  vi.spyOn(imageCommands, 'prepareLocalRedraw').mockResolvedValue({ cropSource: 'C:/crop.png', createdFilePaths: [], context: {
    version: 2, requestId: 'crop-context', source: 'C:/reference.png', mask: 'C:/mask.png', sourceWidth: 8, sourceHeight: 8,
    crop: { x: 0, y: 0, width: 8, height: 8 }, matchedAspectRatio: 1, settings: DEFAULT_LOCAL_REDRAW_SETTINGS,
  } })
  vi.spyOn(imageCommands, 'composeLocalRedraw').mockResolvedValue({ source: 'C:/composite.png', registrationApplied: true,
    diagnostics: { referenceKeypoints: 0, movingKeypoints: 0, matches: 0, inliers: 0, inlierRatio: 0, coverage: 0, medianError: 0,
      structuralScore: 0, scaleX: 1, scaleY: 1, translationX: 0, translationY: 0, refinementIterations: 0, elapsedMs: 0 } })
  vi.spyOn(getPlatform().image, 'composeLayerStack').mockImplementation(async input => ({
    stackId: input.stackId, canvasWidth: 8, canvasHeight: 8,
    resources: input.layers.map(layer => ({ sourceOutputIndex: layer.sourceOutputIndex, filePath: layer.source,
      mimeType: 'image/png', width: 8, height: 8, hasAlpha: true, byteLength: 100, sha256: 'fixture', placement: { x: 0, y: 0, width: 8, height: 8 } })),
    compositePath: 'C:/composite.png', compositeSha256: 'fixture', thumbnailPath: 'C:/thumb.webp', thumbnailSha256: 'fixture',
    thumbnailWidth: 8, thumbnailHeight: 8, createdFilePaths: [],
  }))
  vi.spyOn(documentAdapter, 'createMultiLayerDocumentFromLayerStack').mockResolvedValue({ imageUrl: 'C:/composite.png',
    previewImageUrl: 'C:/thumb.webp', aspectRatio: '1:1', imageEditSession: { kind: 'image-edit-v3',
      sourceUrl: 'C:/composite.png', documentRef: 'image-edit-v3:fixture', revision: 0, previewRef: null } })
})
afterEach(() => { resetCanvasExecutionServiceForTests(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function addSpecialNode(kind: 'redraw' | 'layers') {
  const canvas = useCanvasStore.getState()
  const sourceId = canvas.addNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: 'C:/reference.png' })
  const nodeId = canvas.addNode(kind === 'redraw' ? CANVAS_NODE_TYPES.elementEditGen : CANVAS_NODE_TYPES.layerSeparationGen,
    { x: 400, y: 0 }, { modelId: kind === 'redraw' ? 'apimart-gpt-image-2' : 'volcengine-seedream-5.0-pro',
      prompt: kind === 'redraw' ? '移除标识' : '', localRedrawMaskSource: 'C:/mask.png', localRedrawMaskDocument: {
        version: 1, sourceRef: 'C:/reference.png', width: 8, height: 8,
        strokes: [{ id: 'paint', kind: 'stroke', mode: 'paint', size: 2, points: [{ x: 4, y: 4 }] }],
      } })
  canvas.addEdge(sourceId, nodeId)
  return { nodeId, sourceId }
}

it.each(['redraw', 'layers'] as const)('%s 缺少必要输入时准备失败，不登记或调用供应商', async kind => {
  const { nodeId } = addSpecialNode(kind)
  if (kind === 'redraw') useCanvasStore.getState().updateNodeData(nodeId, { localRedrawMaskSource: null })
  else useCanvasStore.getState().setCanvasData(useCanvasStore.getState().nodes, [])
  const generate = vi.spyOn(GenerationService.getInstance(), 'generate')
  await expect(prepareCanvasNodeGeneration({ projectId, nodeId })).rejects.toThrow()
  expect(records.size).toBe(0)
  expect(generate).not.toHaveBeenCalled()
})

it.each(['ui', 'mcp'] as const)('%s 准备后修改蒙版使旧输入失效，不会提交过时请求', async entry => {
  const { nodeId } = addSpecialNode('redraw')
  const prepared = await prepareCanvasNodeGeneration({ projectId, nodeId })
  const profile = createGenerationNodeExecutor(store => readCanvasGenerationNodeProfile(nodeId, store))
  const signature = profile.getInputSignatureExtras?.(useCanvasStore)
  useCanvasStore.getState().updateNodeData(nodeId, { localRedrawMaskSource: 'C:/changed-mask.png' })
  if (entry === 'mcp') await expect(submitCanvasNodeGeneration(prepared.submitInput, crypto.randomUUID())).rejects.toThrow('节点输入已改变')
  else expect(profile.getInputSignatureExtras?.(useCanvasStore)).not.toEqual(signature)
  expect(records.size).toBe(0)
})

it.each([
  ['redraw', 'ui', false], ['redraw', 'mcp', false], ['redraw', 'mcp', true],
  ['layers', 'ui', false], ['layers', 'mcp', false], ['layers', 'mcp', true],
] as const)('%s 首次生成通过 %s 在切换后保存原项目（取消 %s）', async (kind, entry, cancel) => {
  const { nodeId, sourceId } = addSpecialNode(kind)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const base = { version: 1 as const, sourceOutputIndex: 0, url: 'C:/base.png', filePath: 'C:/base.png', zIndex: 0, role: 'base' as const, width: 8, height: 8, format: 'png' as const }
  const generate = vi.spyOn(GenerationService.getInstance(), 'generate').mockImplementation(async () => {
    await gate
    return { status: 'completed', url: 'C:/base.png', filePath: 'C:/base.png', ...(kind === 'layers' ? { structuredOutput: {
      version: 1 as const, kind: 'layer-stack' as const, primary: base, outputs: [base],
      metadata: { colorSpace: 'srgb' as const, alphaMode: 'straight' as const, compositeOperation: 'source-over' as const, order: 'bottom-to-top' as const },
    } } : {}) }
  })
  let outcome: Promise<unknown> | undefined
  let unmount = () => undefined as void
  try {
    if (entry === 'ui') {
      unmount = registerCanvasNodeExecutor(nodeId, createGenerationNodeExecutor(store => readCanvasGenerationNodeProfile(nodeId, store)))
      outcome = runCanvasNode(nodeId).catch(error => error)
    } else {
      const prepared = await prepareCanvasNodeGeneration({ projectId, nodeId })
      await submitCanvasNodeGeneration(prepared.submitInput, crypto.randomUUID())
    }
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(records.size).toBe(1)
    const taskId = [...records.keys()][0]
    const before = await readPersistedCanvasProjectSnapshot(projectId)
    expect(before.nodes.filter(node => node.data.generationTaskId === taskId)).toHaveLength(1)
    expect(before.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: sourceId, target: nodeId })]))
    expect(await getCanvasGenerationTask(taskId)).toMatchObject({ cancellable: true, resultAvailable: false })
    const other = await useProjectStore.getState().createProject('保持当前页面')
    unmount()
    if (cancel) await cancelCanvasGenerationTask(taskId)
    release()
    await outcome
    await vi.waitFor(() => expect(records.get(taskId)?.status).toBe(cancel ? 'cancelled' : 'success'))
    const saved = await readPersistedCanvasProjectSnapshot(projectId)
    const results = saved.nodes.filter(node => node.data.generationTaskId === taskId)
    expect(results).toHaveLength(1)
    if (!cancel) {
      expect(results[0].data).toMatchObject({ imageUrl: 'C:/composite.png', isGenerating: false })
      expect(records.get(taskId)?.filePath).toBe('C:/composite.png')
      expect(generate.mock.calls[0][3]).toMatchObject({ requestId: taskId })
    }
    expect(await getCanvasGenerationTask(taskId)).toMatchObject({ resultAvailable: !cancel, cancellable: false })
    expect(useProjectStore.getState().currentProjectId).toBe(other)
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
    expect(generate).toHaveBeenCalledTimes(1)
  } finally { release(); await outcome; unmount() }
})
