'use strict'

const { dispatch, findPanePoint, releasePointer } = require('./canvasPanInput.cjs')
const { planSweepViewport } = require('./canvasPanViewport.cjs')

/**
 * 画布平移性能基准的公共能力：真实内容 fixture 生成、抓取点查找、连续扫掠驱动、每轮自检。
 *
 * 为什么不复用 `canvasPerf.cjs` 的 `drivePan`：那个驱动在画布中心 ±30px 来回晃，
 * 瓦片全部命中光栅缓存，稳定 60fps，**测不出真实存在的顿挫**。
 * 本模块统一采用「连续单向扫掠」，让画面里一直有从未光栅过的新内容。
 */

const FIXTURE_PREFIX = '__panbench_'

// 复制副本之间留出的空隙（流坐标 px），避免副本节点与源节点视觉粘连
const COPY_GAP = 1200

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * 把一份图按网格复制 multiplier 份。
 * 节点 id 加 `__c{n}` 后缀，并对整段 JSON 做「带引号的整串替换」，
 * 这样 data 里对其他节点 id 的引用（媒体输入、分组关系等）也会一起改写。
 */
function duplicateGraph(nodesJson, edgesJson, multiplier) {
  const baseNodes = JSON.parse(nodesJson)
  const baseEdges = JSON.parse(edgesJson)
  if (multiplier <= 1) {
    return { nodes: baseNodes, edges: baseEdges }
  }

  const ids = baseNodes.map((node) => node.id).filter((id) => typeof id === 'string' && id.length > 0)
  const xs = baseNodes.map((node) => node.position?.x ?? 0)
  const ys = baseNodes.map((node) => node.position?.y ?? 0)
  const tileWidth = Math.max(...xs) - Math.min(...xs) + COPY_GAP

  const nodes = [...baseNodes]
  const edges = [...baseEdges]

  // 横向单排铺开：扫掠沿 x 方向进行，单排能让整段路径都压在真实内容上，
  // 网格铺法会让扫掠很快走进空白区，测出的是"空画布 60fps"。
  for (let copy = 1; copy < multiplier; copy += 1) {
    const suffix = `__c${copy}`
    let nodeText = nodesJson
    let edgeText = edgesJson
    for (const id of ids) {
      const needle = new RegExp(`"${escapeRegExp(id)}"`, 'g')
      nodeText = nodeText.replace(needle, `"${id}${suffix}"`)
      edgeText = edgeText.replace(needle, `"${id}${suffix}"`)
    }

    const offsetX = copy * tileWidth

    for (const node of JSON.parse(nodeText)) {
      // 子节点坐标相对父节点，父节点整体平移后子节点不能再平移
      if (node.position && !node.parentId) {
        node.position = { x: node.position.x + offsetX, y: node.position.y }
      }
      nodes.push(node)
    }
    for (const edge of JSON.parse(edgeText)) {
      edges.push({ ...edge, id: `${edge.id}${suffix}` })
    }
  }

  return { nodes, edges }
}

async function readProjectRowByName(page, name) {
  return page.evaluate(async (projectName) => {
    const rows = await window.henjiNative.db.select(
      `SELECT id, name, node_count, nodes_json, edges_json, viewport_json
       FROM storyboard_projects WHERE name = ? ORDER BY updated_at DESC LIMIT 1`,
      [projectName]
    )
    return rows.length ? rows[0] : null
  }, name)
}

/**
 * 用真实项目的节点数据生成临时项目。
 * 媒体路径原样保留，因此仍然是真实图片/视频负载，而不是占位图 fixture。
 */
async function createRealContentFixture(page, {
  sourceProject,
  multiplier = 1,
  tempName,
  viewportPlan,
} = {}) {
  const source = await readProjectRowByName(page, sourceProject)
  if (!source) {
    throw new Error(`找不到源项目：${sourceProject}（请确认真实数据库中存在该项目）`)
  }

  const { nodes, edges } = duplicateGraph(source.nodes_json, source.edges_json, multiplier)
  const fixtureName = tempName || `${FIXTURE_PREFIX}${Date.now()}`
  const nodeTypes = new Set(nodes.map((node) => node.type))
  const sourceViewport = JSON.parse(source.viewport_json)
  const viewport = viewportPlan
    ? planSweepViewport(nodes, { ...viewportPlan, zoom: viewportPlan.zoom ?? sourceViewport.zoom })
    : sourceViewport

  const projectId = await page.evaluate(async (payload) => {
    const id = `panbench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    await window.henjiNative.db.execute(
      `INSERT INTO storyboard_projects
       (id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payload.name,
        now,
        now,
        payload.nodeCount,
        payload.nodesJson,
        payload.edgesJson,
        payload.viewportJson,
        JSON.stringify({ past: [], future: [], imagePool: [] }),
      ]
    )
    return id
  }, {
    name: fixtureName,
    nodeCount: nodes.length,
    nodesJson: JSON.stringify(nodes),
    edgesJson: JSON.stringify(edges),
    viewportJson: JSON.stringify({ x: viewport.x, y: viewport.y, zoom: viewport.zoom }),
  })

  return {
    projectId,
    projectName: fixtureName,
    sourceProjectId: source.id,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypeCount: nodeTypes.size,
    nodeTypes: [...nodeTypes].sort(),
    sourceViewport,
    viewport,
  }
}

/** 按名称前缀删除临时项目，避免污染真实数据 */
async function removeFixtures(page, prefix = FIXTURE_PREFIX) {
  return page.evaluate(async (namePrefix) => {
    const rows = await window.henjiNative.db.select(
      'SELECT id FROM storyboard_projects WHERE name LIKE ?',
      [`${namePrefix}%`]
    )
    for (const row of rows) {
      await window.henjiNative.db.execute('DELETE FROM storyboard_projects WHERE id = ?', [row.id])
    }
    return rows.length
  }, prefix)
}

async function readCanvasState(page) {
  return page.evaluate(() => {
    const viewportEl = document.querySelector('.react-flow__viewport')
    const matrix = viewportEl ? new DOMMatrixReadOnly(getComputedStyle(viewportEl).transform) : null
    const nodes = Array.from(document.querySelectorAll('.react-flow__node'))
    const visible = nodes.filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight
    })
    return {
      x: matrix ? matrix.m41 : Number.NaN,
      y: matrix ? matrix.m42 : Number.NaN,
      zoom: matrix ? matrix.a : Number.NaN,
      nodeCount: nodes.length,
      visibleNodeCount: visible.length,
    }
  })
}

function startFrameSampler(page, durationMs) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const readViewport = () => {
      const el = document.querySelector('.react-flow__viewport')
      if (!el) return { x: Number.NaN, y: Number.NaN, zoom: Number.NaN }
      const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
    }
    const countVisibleNodes = () => Array.from(document.querySelectorAll('.react-flow__node')).filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight
    }).length

    const startViewport = readViewport()
    const startVisibleNodeCount = countVisibleNodes()
    const start = performance.now()
    let previous = start
    let frames = 0
    const intervals = []

    const tick = () => {
      const now = performance.now()
      frames += 1
      intervals.push(now - previous)
      previous = now
      if (now - start >= duration) {
        resolve({
          frames,
          elapsedMs: now - start,
          intervals,
          startViewport,
          endViewport: readViewport(),
          startVisibleNodeCount,
          endVisibleNodeCount: countVisibleNodes(),
        })
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), durationMs)
}

/**
 * 连续单向扫掠。走到边缘就「松手再抓」继续同向前进。
 *
 * ⚠️ 松手再抓必须先发一次 `buttons: 0` 的 mouseMoved，否则 d3-zoom 会把坐标跳变
 * 当成继续拖动，视口偏移指数爆炸（实测到 1e237），画布飞到无穷远，
 * 之后测到的全是空画布上的 60fps。
 */
async function sweep(page, session, {
  grab,
  durationMs = 1500,
  dx = -12,
  dy = 0,
  intervalMs = 8,
  measure = true,
} = {}) {
  const flowRect = await page.evaluate(() => {
    const flow = document.querySelector('.react-flow')
    if (!flow) return null
    const rect = flow.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  })
  if (!flowRect) throw new Error('未找到 .react-flow 容器')

  const margin = 60
  const samplePromise = measure ? startFrameSampler(page, durationMs) : null

  let x = grab.x
  let y = grab.y
  let regrabs = 0
  dispatch(session, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })

  const startedAt = Date.now()
  while (Date.now() - startedAt < durationMs) {
    let nextX = x + dx
    let nextY = y + dy
    const outOfBounds =
      nextX < flowRect.left + margin || nextX > flowRect.right - margin ||
      nextY < flowRect.top + margin || nextY > flowRect.bottom - margin

    if (outOfBounds) {
      dispatch(session, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      const regrab = await findPanePoint(page, {
        preferRatioX: dx < 0 ? 0.86 : dx > 0 ? 0.14 : 0.5,
        preferRatioY: dy < 0 ? 0.82 : dy > 0 ? 0.18 : 0.5,
      })
      const target = regrab || grab
      // 必须先发一次「未按下」的移动，让 d3-zoom 结束上一段拖动
      dispatch(session, { type: 'mouseMoved', x: target.x, y: target.y, button: 'none', buttons: 0 })
      await sleep(20)
      dispatch(session, { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 })
      x = target.x
      y = target.y
      regrabs += 1
      nextX = x + dx
      nextY = y + dy
    }

    x = nextX
    y = nextY
    dispatch(session, { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
    await sleep(intervalMs)
  }

  // 最终松手必须 await：前面的 move 为了保持输入频率没有逐个等待，如果这里也不等，
  // 下一次复位可能在 CDP 输入队列尚未结束时再次按下，d3-zoom 会停在拖动状态。
  await releasePointer(session, { x, y })
  await sleep(30)

  if (!measure) {
    return { measured: false, regrabs }
  }

  const sample = await samplePromise
  const sorted = [...sample.intervals].sort((left, right) => left - right)
  const pick = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0
  const netMove = Math.hypot(
    sample.endViewport.x - sample.startViewport.x,
    sample.endViewport.y - sample.startViewport.y
  )
  const finite = Number.isFinite(sample.endViewport.x) && Number.isFinite(sample.endViewport.y) &&
    Math.abs(sample.endViewport.x) < 1e7 && Math.abs(sample.endViewport.y) < 1e7

  const minVisible = Math.min(sample.startVisibleNodeCount, sample.endVisibleNodeCount)
  const invalidReasons = []
  if (!finite) invalidReasons.push('视口坐标异常（可能发生指数爆炸）')
  if (!(netMove > 300)) invalidReasons.push(`净位移过小（${netMove.toFixed(1)}px）`)
  if (minVisible < 5) invalidReasons.push(`扫掠途中可见节点过少（最少 ${minVisible} 个，说明走到了空白区）`)

  return {
    measured: true,
    valid: invalidReasons.length === 0,
    invalidReasons,
    regrabs,
    fps: Number(((sample.frames / sample.elapsedMs) * 1000).toFixed(1)),
    frames: sample.frames,
    elapsedMs: Number(sample.elapsedMs.toFixed(1)),
    p50Ms: Number(pick(0.5).toFixed(2)),
    p95Ms: Number(pick(0.95).toFixed(2)),
    p99Ms: Number(pick(0.99).toFixed(2)),
    maxMs: Number((sorted.at(-1) || 0).toFixed(2)),
    droppedOver25Ms: sorted.filter((value) => value > 25).length,
    droppedOver50Ms: sorted.filter((value) => value > 50).length,
    netMove: Number(netMove.toFixed(1)),
    startVisibleNodeCount: sample.startVisibleNodeCount,
    endVisibleNodeCount: sample.endVisibleNodeCount,
    startViewport: sample.startViewport,
    endViewport: sample.endViewport,
  }
}

/**
 * 把视口精确拖回目标位置。
 *
 * 平移与鼠标位移是 1:1 的，所以只要按住拖动 (targetX - currentX, targetY - currentY) 即可。
 * 单次拖动受窗口边界限制，位移过大时分段完成；每段之间同样遵守
 * 「松手 → buttons:0 移动 → 再按下」的顺序。
 */
async function resetViewport(page, session, target, { tolerance = 4, maxPasses = 10 } = {}) {
  // 先把上一段可能仍在 CDP 队列中的拖动态归零；mouseReleased 在未按下时是幂等的。
  const neutral = await findPanePoint(page)
  if (neutral) {
    await releasePointer(session, neutral)
    await sleep(30)
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const state = await readCanvasState(page)
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
      throw new Error('视口坐标异常，无法复位')
    }
    const deltaX = target.x - state.x
    const deltaY = target.y - state.y
    if (Math.abs(deltaX) <= tolerance && Math.abs(deltaY) <= tolerance) {
      return { ok: true, passes: pass }
    }

    const from = await findPanePoint(page, {
      preferRatioX: deltaX > 0 ? 0.16 : 0.84,
      preferRatioY: deltaY > 0 ? 0.2 : 0.8,
    })
    if (!from) throw new Error('复位时找不到落在 .react-flow__pane 上的抓取点')

    const bounds = await page.evaluate(() => {
      const flow = document.querySelector('.react-flow')
      const rect = flow.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    const margin = 50
    const stepX = Math.max(bounds.left + margin - from.x, Math.min(bounds.right - margin - from.x, deltaX))
    const stepY = Math.max(bounds.top + margin - from.y, Math.min(bounds.bottom - margin - from.y, deltaY))

    // 复位不参与测量，这里逐个 await，保证每一次派发都真正落到页面上
    const send = (params) => session.send('Input.dispatchMouseEvent', params)
    // Space 是 ReactFlow 的平移激活键；复位路径上即使节点移动到指针下方，拖动也不会中断。
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    })
    await send({ type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    const segments = 12
    for (let i = 1; i <= segments; i += 1) {
      await send({
        type: 'mouseMoved',
        x: Math.round(from.x + (stepX * i) / segments),
        y: Math.round(from.y + (stepY * i) / segments),
        button: 'left',
        buttons: 1,
      })
    }
    const endX = Math.round(from.x + stepX)
    const endY = Math.round(from.y + stepY)
    await send({ type: 'mouseReleased', x: endX, y: endY, button: 'left', buttons: 0, clickCount: 1 })
    await send({ type: 'mouseMoved', x: endX, y: endY, button: 'none', buttons: 0 })
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    })
    await sleep(80)
  }
  const final = await readCanvasState(page)
  return {
    ok: Math.abs(target.x - final.x) <= 24 && Math.abs(target.y - final.y) <= 24,
    passes: maxPasses,
    final,
  }
}

module.exports = {
  FIXTURE_PREFIX,
  planSweepViewport,
  resetViewport,
  createRealContentFixture,
  removeFixtures,
  findPanePoint,
  readCanvasState,
  sweep,
  duplicateGraph,
  median,
  sleep,
}
