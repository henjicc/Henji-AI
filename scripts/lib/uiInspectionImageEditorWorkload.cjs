const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')
const WORKLOAD_FOREGROUND = { width: 320, height: 240, color: 'rgb(18, 211, 106)', transform: [1, 0, 0, 1, 600, 350] }

const COUNTERS = {
  revision: ['[data-command-bar]', 'data-document-revision'],
  generation: ['[data-preview-surface]', 'data-preview-render-generation'],
  cpuPlan: ['[data-presentation-front-surface]', 'data-render-plan-compile-count'],
  cpuTasks: ['[data-presentation-front-surface]', 'data-cpu-task-start-count'],
  gpuGeneration: ['[data-presentation-front-surface]', 'data-render-generation'],
  camera: ['[data-presentation-front-surface]', 'data-camera-sequence'],
  gpuFrames: ['[data-presentation-front-surface]', 'data-gpu-surface-frame-count'],
  gpuUploads: ['[data-presentation-front-surface]', 'data-gpu-upload-count'],
  gpuReadbacks: ['[data-presentation-front-surface]', 'data-gpu-readback-count'],
}

async function readWorkloadSnapshot(editor) {
  return editor.evaluate((root, fields) => {
    const result = {}
    for (const [key, [selector, attribute]] of Object.entries(fields)) {
      const raw = root.querySelector(selector)?.getAttribute(attribute)
      result[key] = raw === null || raw === undefined || raw === '' ? null : Number(raw)
    }
    const preview = root.querySelector('[data-preview-surface]')
    const gpu = root.querySelector('[data-presentation-gpu-surface]')
    return { ...result,
      composition: preview?.getAttribute('data-preview-composition-backend'),
      presentation: preview?.getAttribute('data-preview-presentation-backend'),
      visible: gpu instanceof HTMLElement && getComputedStyle(gpu).visibility === 'visible',
    }
  }, COUNTERS)
}

function assertGpuSnapshot(value) {
  for (const name of Object.keys(COUNTERS)) {
    if (!Number.isSafeInteger(value[name]) || value[name] < 0) throw new Error(`缺少真实工作量计数：${name}`)
  }
  if (value.composition !== 'gpu' || value.presentation !== 'webgpu-surface' || !value.visible
    || value.generation !== value.gpuGeneration || value.gpuFrames < 1) throw new Error('工作量采样尚未显示当前GPU场景')
}

function summarizeWorkloadPhase(name, snapshots, operations, logs) {
  if (snapshots.length !== operations + 1) throw new Error('工作量样本数量与实际操作不一致')
  snapshots.forEach(assertGpuSnapshot)
  const before = snapshots[0], after = snapshots.at(-1)
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1], current = snapshots[index]
    for (const key of Object.keys(COUNTERS)) {
      if (current[key] < previous[key]) throw new Error(`会话计数倒退：${key}`)
    }
    if (name === 'authoritative-edits') {
      if (current.revision !== previous.revision + 1 || current.generation <= previous.generation) {
        throw new Error('显隐操作没有精确提交一次权威修改')
      }
    } else if (current.revision !== before.revision || current.camera <= previous.camera) {
      throw new Error('相机操作未跨RAF生效，或意外修改文档')
    }
  }
  if (after.gpuReadbacks !== before.gpuReadbacks) throw new Error('GPU正常采样意外发生回读')
  const unique = new Map()
  for (const event of logs) {
    if (!event.requestId || !['image_editor_v3.viewport_composite.start', 'image_editor_v3.viewport_composite.completed'].includes(event.event)) continue
    unique.set(`${event.event}:${event.requestId}`, event)
  }
  const starts = [...unique.values()].filter((event) => event.event.endsWith('.start'))
  const completed = [...unique.values()].filter((event) => event.event.endsWith('.completed'))
  return { phase: name, operations, before, after,
    delta: Object.fromEntries(Object.keys(COUNTERS).map((key) => [key, after[key] - before[key]])),
    cpuWorkerEvidence: {
      startedRequests: starts.length, completedRequests: completed.length,
      completedTiles: completed.reduce((sum, event) => sum + (event.context?.tileCount ?? 0), 0),
      completedWorkerWallMs: completed.reduce((sum, event) => sum + (event.context?.workerMs ?? 0), 0),
      requests: [...unique.values()].map(({ requestId, event, context }) => ({ requestId, event, phase: context?.phase,
        revision: context?.revision, tileCount: context?.tileCount, workerMs: context?.workerMs })),
      meaning: '正式合成请求及已完成Worker墙钟时间；不等于CPU线程耗时，不包含尚未完成/已取消请求的完整工作量',
    },
  }
}

async function waitForCurrentGpu(page, editor, accept = () => true) {
  const deadline = Date.now() + 30000
  let value
  while (Date.now() < deadline) {
    value = await readWorkloadSnapshot(editor)
    try { assertGpuSnapshot(value); if (accept(value)) return value } catch { /* 等待正式可见结果，不改状态 */ }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  }
  throw new Error(`当前GPU工作量采样超时：${JSON.stringify(value)}`)
}

async function collectWorkerLogs(page, afterTimestamp, beforeTimestamp, documentId, expectedStarts) {
  // 正式frontend日志有缓冲。等已观察到的启动数进入唯一日志查询，不人为延长输入间隔。
  const deadline = Date.now() + 10000
  let events = []
  while (Date.now() < deadline) {
    events = await page.evaluate(async ({ afterTimestamp, beforeTimestamp, documentId }) => {
      const result = await window.henjiNative.logging.queryLogEvents({
        date: afterTimestamp.slice(0, 10), afterTimestamp, beforeTimestamp,
        domainPrefix: 'image_editor_v3.viewport_composite', keyword: documentId, limit: 1000,
      })
      if (result.hasMore) throw new Error('工作量日志超过单次有界采集上限，不能报告不完整基线')
      return result.events
    }, { afterTimestamp, beforeTimestamp, documentId })
    const starts = new Set(events.filter((event) => event.event === 'image_editor_v3.viewport_composite.start').map((event) => event.requestId))
    if (starts.size >= expectedStarts) return events
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  }
  throw new Error(`正式Worker启动日志尚未完整落地：期望至少${expectedStarts}，已读${events.length}条事件`)
}

function createImageEditorWorkloadScenes(context) {
  return [{ id: 'canvas-gpu-session-workload', surface: '画布', name: '画布-GPU会话工作量基线', writesUserData: true,
    setup: async (page, _app, helpers = {}) => {
      const { editor, fixture } = await openCanvasImageEditorV3Fixture({
        page, context, width: 1600, height: 1000, label: '双独立资源会话工作量夹具', foreground: WORKLOAD_FOREGROUND,
      })
      if (!fixture.foregroundResourceRef || fixture.foregroundResourceRef === fixture.sourceResourceRef) {
        throw new Error('工作量夹具缺少真实独立前景资源')
      }
      const initial = await waitForCurrentGpu(page, editor)
      const row = editor.locator('[data-layer-id="reality-gpu-foreground-layer"]')
      const documentId = fixture.documentRef.replace(/^image-edit-v3:/, '')
      const phases = []
      const measure = async (name, count, action) => {
        const startedAt = await page.evaluate(() => new Date().toISOString())
        const samples = [await waitForCurrentGpu(page, editor)]
        for (let index = 0; index < count; index += 1) {
          await action(index)
          const previous = samples.at(-1)
          samples.push(await waitForCurrentGpu(page, editor, (next) => name === 'authoritative-edits'
            ? next.revision === previous.revision + 1 && next.generation > previous.generation
            : next.camera > previous.camera))
        }
        const endedAt = await page.evaluate(() => new Date().toISOString())
        const logs = await collectWorkerLogs(page, startedAt, endedAt, documentId,
          samples.at(-1).cpuTasks - samples[0].cpuTasks)
        phases.push(summarizeWorkloadPhase(name, samples, count, logs))
      }
      // 显隐按钮直接提交一次命令，不混入属性输入的瞬态PreviewOverride。
      await measure('authoritative-edits', 10, () => row.getByRole('button', { name: /^(隐藏|显示|Hide|Show)/i }).click())
      const zoom = editor.locator('[data-viewport-control]')
      await measure('camera-updates', 20, (index) => zoom.getByRole('button').nth(index % 2 === 0 ? 1 : 0).click())
      const stored = await page.evaluate(async (documentRef) => {
        const loaded = await window.henjiNative.imageEditorV3.loadDocument({ requestId: `reality-workload-${crypto.randomUUID()}`, documentRef })
        return { revision: loaded.revision, backgroundVisible: loaded.document.layers[0]?.visible,
          foregroundVisible: loaded.document.layers[1]?.visible }
      }, fixture.documentRef)
      if (stored.backgroundVisible !== true) throw new Error('工作量采样背景必须始终可见')
      // 保存是独立异步链；只记录这次读到的事实，不能将当前内存revision冒充落盘确认。
      const evidence = { fixture: 'synthetic-two-independent-rasters-1600x1000-background-320x240-foreground', initial, phases, stored,
        resourceRefs: [fixture.sourceResourceRef, fixture.foregroundResourceRef], interaction: 'toggle-foreground-only; background-remains-visible',
        requestedWindowSize: helpers.requestedWindowSize ?? null,
        timingMeaning: '每次操作等待实际GPU提交确认及跨RAF状态，不测物理屏幕呈现延迟',
        comparison: 'unoptimized-workload-capture; no-assumed-speedup' }
      await page.evaluate(async (context) => window.henjiNative.logging.logFrontendEvents([{
        timestamp: new Date().toISOString(), level: 'info', domain: 'image_editor_v3.reality_workload',
        event: 'image_editor_v3.reality_workload.captured', message: '真实图片编辑会话工作量采集完成', context,
      }]), evidence)
      process.stdout.write(`[image-editor-session-workload] ${JSON.stringify(evidence)}\n`)
      await helpers.capture?.('workload')
    },
  }]
}

module.exports = { COUNTERS, WORKLOAD_FOREGROUND, assertGpuSnapshot, summarizeWorkloadPhase, collectWorkerLogs, createImageEditorWorkloadScenes }
