'use strict'

/**
 * 画布平移基准的诊断指标。
 *
 * CDP Performance 指标负责区分脚本、样式、布局与堆增长；页面侧探针负责统计
 * ResizeObserver 和 Long Task；LayerTree 是较重的可选诊断，只在显式开启时采集。
 */

const CDP_METRICS = [
  'RecalcStyleCount',
  'RecalcStyleDuration',
  'LayoutCount',
  'LayoutDuration',
  'TaskDuration',
  'ScriptDuration',
  'JSHeapUsedSize',
  'JSHeapTotalSize',
  'Nodes',
  'JSEventListeners',
]

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(digits))
}

function metricMap(response) {
  const metrics = new Map((response?.metrics || []).map((metric) => [metric.name, metric.value]))
  return Object.fromEntries(CDP_METRICS.map((name) => [name, metrics.get(name) || 0]))
}

function diffMetrics(before, after) {
  const delta = (name) => (after[name] || 0) - (before[name] || 0)
  return {
    styleRecalcCount: round(delta('RecalcStyleCount'), 0),
    styleRecalcDurationMs: round(delta('RecalcStyleDuration') * 1000),
    layoutCount: round(delta('LayoutCount'), 0),
    layoutDurationMs: round(delta('LayoutDuration') * 1000),
    taskDurationMs: round(delta('TaskDuration') * 1000),
    scriptDurationMs: round(delta('ScriptDuration') * 1000),
    heapDeltaBytes: round(delta('JSHeapUsedSize'), 0),
    heapUsedBytes: round(after.JSHeapUsedSize || 0, 0),
    heapTotalBytes: round(after.JSHeapTotalSize || 0, 0),
    nodesDelta: round(delta('Nodes'), 0),
    nodeCount: round(after.Nodes || 0, 0),
    eventListenersDelta: round(delta('JSEventListeners'), 0),
    eventListenerCount: round(after.JSEventListeners || 0, 0),
  }
}

async function installPageDiagnostics(page) {
  await page.evaluate(() => {
    const key = '__HENJI_PAN_DIAGNOSTICS__'
    if (window[key]) return

    const state = {
      resizeObserver: {
        callbacks: 0,
        entries: 0,
        nodeEntries: 0,
        movingCallbacks: 0,
        movingEntries: 0,
        maxEntries: 0,
      },
      longTasks: [],
      reset() {
        for (const metric of Object.keys(this.resizeObserver)) this.resizeObserver[metric] = 0
        this.longTasks.length = 0
      },
    }

    const NativeResizeObserver = window.ResizeObserver
    if (NativeResizeObserver) {
      window.ResizeObserver = class InstrumentedResizeObserver extends NativeResizeObserver {
        constructor(callback) {
          super((entries, observer) => {
            const moving = Boolean(document.querySelector('.canvas-viewport-moving'))
            const nodeEntries = entries.filter((entry) => entry.target.closest?.('.react-flow__node')).length
            state.resizeObserver.callbacks += 1
            state.resizeObserver.entries += entries.length
            state.resizeObserver.nodeEntries += nodeEntries
            state.resizeObserver.maxEntries = Math.max(state.resizeObserver.maxEntries, entries.length)
            if (moving) {
              state.resizeObserver.movingCallbacks += 1
              state.resizeObserver.movingEntries += entries.length
            }
            callback(entries, observer)
          })
        }
      }
    }

    if (window.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
      })
      observer.observe({ type: 'longtask', buffered: false })
    }

    window[key] = state
  })
}

async function resetPageDiagnostics(page) {
  await page.evaluate(() => window.__HENJI_PAN_DIAGNOSTICS__?.reset())
}

async function readPageDiagnostics(page) {
  return page.evaluate(() => {
    const state = window.__HENJI_PAN_DIAGNOSTICS__
    if (!state) return null
    const durations = [...state.longTasks]
    return {
      resizeObserver: { ...state.resizeObserver },
      longTasks: {
        count: durations.length,
        durationMs: Number(durations.reduce((sum, value) => sum + value, 0).toFixed(2)),
        totalBlockingTimeMs: Number(durations.reduce((sum, value) => sum + Math.max(0, value - 50), 0).toFixed(2)),
        maxDurationMs: Number((durations.length ? Math.max(...durations) : 0).toFixed(2)),
      },
    }
  })
}

function layerCounts(layers) {
  const list = layers || []
  return {
    layerCount: list.length,
    drawsContentCount: list.filter((layer) => layer.drawsContent).length,
    backendNodeLayerCount: list.filter((layer) => layer.backendNodeId).length,
  }
}

function listenerSignature(listener) {
  return [
    listener.type,
    listener.useCapture ? 'capture' : 'bubble',
    listener.passive ? 'passive' : 'active',
    listener.once ? 'once' : 'repeat',
    listener.scriptId || '',
    listener.lineNumber ?? '',
    listener.columnNumber ?? '',
  ].join(':')
}

async function readTargetListeners(session, { listenerTree = false } = {}) {
  const targets = {
    window: { expression: 'window', depth: 1 },
    document: { expression: 'document', depth: 1 },
    flow: {
      expression: "document.querySelector('.react-flow')",
      depth: listenerTree ? -1 : 1,
    },
    pane: { expression: "document.querySelector('.react-flow__pane')", depth: 1 },
    viewport: { expression: "document.querySelector('.react-flow__viewport')", depth: 1 },
  }
  const snapshot = {}

  for (const [name, target] of Object.entries(targets)) {
    const evaluated = await session.send('Runtime.evaluate', {
      expression: target.expression,
      returnByValue: false,
      silent: true,
    })
    const objectId = evaluated?.result?.objectId
    if (!objectId) {
      snapshot[name] = []
      continue
    }
    try {
      const response = await session.send('DOMDebugger.getEventListeners', {
        objectId,
        depth: target.depth,
        pierce: true,
      })
      snapshot[name] = (response.listeners || []).map(listenerSignature).sort()
    } finally {
      await session.send('Runtime.releaseObject', { objectId }).catch(() => undefined)
    }
  }
  return snapshot
}

function countItems(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1)
  return counts
}

function subtractItems(left, right) {
  const remaining = countItems(right)
  const result = []
  for (const item of left) {
    const count = remaining.get(item) || 0
    if (count > 0) remaining.set(item, count - 1)
    else result.push(item)
  }
  return result
}

function diffTargetListeners(before, after) {
  const result = {}
  for (const name of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const previous = before?.[name] || []
    const current = after?.[name] || []
    result[name] = {
      before: previous.length,
      after: current.length,
      delta: current.length - previous.length,
      added: subtractItems(current, previous),
      removed: subtractItems(previous, current),
    }
  }
  return result
}

async function createPanDiagnostics(page, session, { layers = false, listenerTree = false } = {}) {
  await session.send('Performance.enable')

  const layerState = {
    latest: [],
    maxLayerCount: 0,
    maxDrawsContentCount: 0,
    maxBackendNodeLayerCount: 0,
    paintedEvents: 0,
  }

  const handleLayerTree = (event) => {
    layerState.latest = event.layers || []
    const counts = layerCounts(layerState.latest)
    layerState.maxLayerCount = Math.max(layerState.maxLayerCount, counts.layerCount)
    layerState.maxDrawsContentCount = Math.max(layerState.maxDrawsContentCount, counts.drawsContentCount)
    layerState.maxBackendNodeLayerCount = Math.max(
      layerState.maxBackendNodeLayerCount,
      counts.backendNodeLayerCount
    )
  }
  const handleLayerPainted = () => {
    layerState.paintedEvents += 1
  }

  if (layers) {
    session.on('LayerTree.layerTreeDidChange', handleLayerTree)
    session.on('LayerTree.layerPainted', handleLayerPainted)
    await session.send('LayerTree.enable')
  }

  return {
    async startRound() {
      await resetPageDiagnostics(page)
      const current = layerCounts(layerState.latest)
      layerState.maxLayerCount = current.layerCount
      layerState.maxDrawsContentCount = current.drawsContentCount
      layerState.maxBackendNodeLayerCount = current.backendNodeLayerCount
      layerState.paintedEvents = 0
      return {
        metrics: metricMap(await session.send('Performance.getMetrics')),
        eventListeners: await readTargetListeners(session, { listenerTree }),
      }
    },

    async endRound(before) {
      const after = metricMap(await session.send('Performance.getMetrics'))
      const pageMetrics = await readPageDiagnostics(page)
      const eventListeners = await readTargetListeners(session, { listenerTree })
      const latest = layerCounts(layerState.latest)
      return {
        cdp: diffMetrics(before.metrics, after),
        ...pageMetrics,
        eventListenerTargets: diffTargetListeners(before.eventListeners, eventListeners),
        layers: layers
          ? {
              ...latest,
              maxLayerCount: layerState.maxLayerCount,
              maxDrawsContentCount: layerState.maxDrawsContentCount,
              maxBackendNodeLayerCount: layerState.maxBackendNodeLayerCount,
              paintedEvents: layerState.paintedEvents,
            }
          : null,
      }
    },

    async collectRetainedState() {
      await session.send('HeapProfiler.collectGarbage')
      await new Promise((resolve) => setTimeout(resolve, 100))
      return {
        metrics: metricMap(await session.send('Performance.getMetrics')),
        eventListeners: await readTargetListeners(session, { listenerTree }),
      }
    },

    diffRetainedState(before, after) {
      return {
        cdp: diffMetrics(before.metrics, after.metrics),
        eventListenerTargets: diffTargetListeners(before.eventListeners, after.eventListeners),
      }
    },

    async dispose() {
      if (!layers) return
      session.off('LayerTree.layerTreeDidChange', handleLayerTree)
      session.off('LayerTree.layerPainted', handleLayerPainted)
      await session.send('LayerTree.disable').catch(() => undefined)
    },
  }
}

module.exports = {
  createPanDiagnostics,
  diffMetrics,
  diffTargetListeners,
  installPageDiagnostics,
  layerCounts,
  metricMap,
}
