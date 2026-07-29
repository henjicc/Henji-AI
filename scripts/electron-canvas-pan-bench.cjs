'use strict'

/**
 * 画布平移性能基准。
 *
 * 与 `electron-phase4-canvas-stress.cjs` 并存：后者是冒烟（能否加载、有无报错、内存），
 * 它的占位图 fixture 和原地小幅拖动**测不出真实顿挫**，不能作为性能结论来源。
 *
 * 本脚本的四条硬约定（详见 docs/task/画布平移性能优化/重要记录.md 记录 004）：
 *   1. 负载用真实项目节点，不用占位图；
 *   2. 驱动用连续单向扫掠，不用原地来回拖；
 *   3. 同一次启动内交替采样各配置，不按配置顺序逐个测（否则第一个配置永远最慢）；
 *   4. 每轮自检，视口爆炸或飘出内容区的轮次判为无效。
 *
 * 环境变量：
 *   BENCH_PROJECT  源项目名称（默认 TEST），只读取不修改
 *   BENCH_MULT     真实内容复制份数（默认 1）
 *   BENCH_SWEEP_MS 单轮扫掠时长（默认 1500）
 *   BENCH_REPS     每个配置的采样轮数（默认 5）
 *   BENCH_SET      逗号分隔的配置名（默认 off,hidenodes）
 *   BENCH_OUT      结果输出目录（默认 .pan-bench）
 *   BENCH_DIAGNOSTICS 是否采集 CDP/Long Task/ResizeObserver 指标（默认 1）
 *   BENCH_LAYERS   是否额外采集合成层指标（默认 0，采集本身有额外开销）
 *   BENCH_LISTENER_TREE 是否深扫画布子树的监听器（默认 0，仅用于泄漏诊断）
 *   BENCH_SOAK_REPS 强制 GC 前后额外执行的往返次数（默认 0，用于保留内存诊断）
 */

const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
const {
  createPanDiagnostics,
  installPageDiagnostics,
} = require('./lib/canvasPanDiagnostics.cjs')
const {
  FIXTURE_PREFIX,
  createRealContentFixture,
  removeFixtures,
  findPanePoint,
  readCanvasState,
  resetViewport,
  sweep,
  median,
  sleep,
} = require('./lib/canvasPanBench.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')
const STYLE_ID = '__pan_bench_style__'

const SOURCE_PROJECT = process.env.BENCH_PROJECT || 'TEST'
const MULTIPLIER = Math.max(1, Number(process.env.BENCH_MULT || 1))
const SWEEP_MS = Math.max(400, Number(process.env.BENCH_SWEEP_MS || 1200))
const REPS = Math.max(1, Number(process.env.BENCH_REPS || 5))
const OUT_DIR = path.join(ROOT, process.env.BENCH_OUT || '.pan-bench')
const DIAGNOSTICS_ENABLED = process.env.BENCH_DIAGNOSTICS !== '0'
const LAYER_DIAGNOSTICS_ENABLED = DIAGNOSTICS_ENABLED && process.env.BENCH_LAYERS === '1'
const LISTENER_TREE_ENABLED = DIAGNOSTICS_ENABLED && process.env.BENCH_LISTENER_TREE === '1'
const SOAK_REPS = DIAGNOSTICS_ENABLED
  ? Math.max(0, Number(process.env.BENCH_SOAK_REPS || 0))
  : 0

// 扫掠速度：每 10ms 走 9 屏幕 px ≈ 900 px/s，接近真实用户的匀速拖动
const SWEEP_STEP_PX = 9
const SWEEP_INTERVAL_MS = 10
const SWEEP_SPEED_PX_PER_SEC = (SWEEP_STEP_PX / SWEEP_INTERVAL_MS) * 1000
const SWEEP_SCREEN_DISTANCE = (SWEEP_MS / SWEEP_INTERVAL_MS) * SWEEP_STEP_PX

/**
 * 候选配置。全部以注入 <style> 的方式生效，互不残留。
 * - off        现状基线
 * - paintdisabled 关闭节点绘制隔离，仅用于同启动 A/B
 * - hidenodes  隐藏节点内容，作为「只画连线与背景」的渲染上限参照
 * - hidewaveforms 隐藏音频节点的高密度 SVG 波形，诊断其独立绘制成本
 * - willchange 历史方案，已确认不可用（会钉死光栅倍率导致文字发虚），仅作对照
 */
const CONFIGS = {
  off: '',
  paintdisabled: '.canvas-node-paint-frame{contain:none!important;}.react-flow__node{contain:none!important;overflow-clip-margin:0!important;}',
  hidenodes: '.react-flow__node{visibility:hidden !important;}',
  hidewaveforms: '.react-flow__node-audioUploadNode .nodrag.nowheel>svg.block,.react-flow__node-audioGenNode .nodrag.nowheel>svg.block{display:none!important;}',
  willchange: '.react-flow__viewport{will-change:transform;}',
}

const CONFIG_SET = (process.env.BENCH_SET || 'off,hidenodes')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)

async function applyConfig(page, name) {
  const css = CONFIGS[name]
  if (css === undefined) throw new Error(`未知配置：${name}（可用：${Object.keys(CONFIGS).join(', ')}）`)
  await page.evaluate(({ styleId, styleText }) => {
    let element = document.getElementById(styleId)
    if (!element) {
      element = document.createElement('style')
      element.id = styleId
      document.head.appendChild(element)
    }
    element.textContent = styleText
  }, { styleId: STYLE_ID, styleText: css })
  await sleep(120)
}

async function openFixtureProject(page, projectName, expectedNodeCount) {
  await page.getByRole('button', { name: /画布|Canvas/ }).click()
  await page.waitForTimeout(600)
  if (await page.locator('.react-flow').count() > 0) {
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await page.waitForTimeout(600)
  }
  await page.getByRole('heading', { name: projectName }).click()
  await page.waitForSelector('.react-flow', { timeout: 30000 })
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
    expectedNodeCount,
    { timeout: 40000 }
  )
  // 等图片解码与首屏光栅稳定，否则第一轮会把加载开销算进帧率
  await page.waitForTimeout(2500)
}

async function recoverFixtureViewport(page, fixture, viewport) {
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await page.waitForTimeout(700)
  await page.evaluate(async ({ projectId, nextViewport }) => {
    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET viewport_json = ? WHERE id = ?',
      [JSON.stringify(nextViewport), projectId]
    )
  }, {
    projectId: fixture.projectId,
    nextViewport: viewport,
  })
  await page.getByRole('heading', { name: fixture.projectName }).click()
  await page.waitForSelector('.react-flow', { timeout: 30000 })
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
    fixture.nodeCount,
    { timeout: 40000 }
  )
  await page.waitForTimeout(1000)
}

async function collectEnvironment(page, session) {
  const dom = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__node'))
    const byType = new Map()
    for (const node of nodes) {
      const typeClass = Array.from(node.classList).find((name) => (
        name.startsWith('react-flow__node-') && name !== 'react-flow__node-selected'
      ))
      const type = typeClass?.slice('react-flow__node-'.length) || 'unknown'
      const descendants = node.querySelectorAll('*').length
      const interactive = node.querySelectorAll('button,input,select,textarea,[role="button"]').length
      const svgElements = node.querySelectorAll('svg,svg *').length
      const mediaElements = node.querySelectorAll('img,video,audio,canvas').length
      const current = byType.get(type) || []
      current.push({ descendants, interactive, svgElements, mediaElements })
      byType.set(type, current)
    }

    const nodeDomByType = Array.from(byType, ([type, rows]) => {
      const summarize = (key) => {
        const values = rows.map((row) => row[key]).sort((left, right) => left - right)
        const mid = Math.floor(values.length / 2)
        const medianValue = values.length % 2
          ? values[mid]
          : (values[mid - 1] + values[mid]) / 2
        return {
          min: values[0] || 0,
          median: medianValue || 0,
          max: values.at(-1) || 0,
        }
      }
      return {
        type,
        count: rows.length,
        descendants: summarize('descendants'),
        interactive: summarize('interactive'),
        svgElements: summarize('svgElements'),
        mediaElements: summarize('mediaElements'),
      }
    }).sort((left, right) => (
      right.descendants.median - left.descendants.median || left.type.localeCompare(right.type)
    ))

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      imageCount: document.querySelectorAll('.react-flow__node img').length,
      videoCount: document.querySelectorAll('.react-flow__node video').length,
      viewportElementCount: document.querySelectorAll('.react-flow__viewport *').length,
      edgeCount: document.querySelectorAll('.react-flow__edge').length,
      nodeDomByType,
    }
  })
  const state = await readCanvasState(page)
  let gpu = null
  try {
    const info = await session.send('SystemInfo.getInfo')
    gpu = info?.gpu?.devices?.map((device) => device.deviceString).filter(Boolean) ?? null
  } catch {
    gpu = null
  }
  return { ...dom, ...state, gpu }
}

function summarize(rounds) {
  const valid = rounds.filter((round) => round.valid)
  const diagnosticMedian = (read) => Number(median(valid.map(read).filter(Number.isFinite)).toFixed(2))
  const diagnostics = valid.some((round) => round.diagnostics)
    ? {
        cdp: {
          styleRecalcCountMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.styleRecalcCount),
          styleRecalcDurationMsMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.styleRecalcDurationMs),
          layoutCountMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.layoutCount),
          layoutDurationMsMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.layoutDurationMs),
          taskDurationMsMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.taskDurationMs),
          scriptDurationMsMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.scriptDurationMs),
          heapDeltaBytesMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.heapDeltaBytes),
          nodesDeltaMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.nodesDelta),
          eventListenersDeltaMedian: diagnosticMedian((round) => round.diagnostics?.cdp?.eventListenersDelta),
        },
        resizeObserver: {
          callbacksMedian: diagnosticMedian((round) => round.diagnostics?.resizeObserver?.callbacks),
          entriesMedian: diagnosticMedian((round) => round.diagnostics?.resizeObserver?.entries),
          nodeEntriesMedian: diagnosticMedian((round) => round.diagnostics?.resizeObserver?.nodeEntries),
          movingCallbacksMedian: diagnosticMedian((round) => round.diagnostics?.resizeObserver?.movingCallbacks),
          movingEntriesMedian: diagnosticMedian((round) => round.diagnostics?.resizeObserver?.movingEntries),
        },
        longTasks: {
          countMedian: diagnosticMedian((round) => round.diagnostics?.longTasks?.count),
          totalBlockingTimeMsMedian: diagnosticMedian((round) => round.diagnostics?.longTasks?.totalBlockingTimeMs),
          maxDurationMsMedian: diagnosticMedian((round) => round.diagnostics?.longTasks?.maxDurationMs),
        },
        layers: valid.some((round) => round.diagnostics?.layers)
          ? {
              maxLayerCountMedian: diagnosticMedian((round) => round.diagnostics?.layers?.maxLayerCount),
              maxDrawsContentCountMedian: diagnosticMedian((round) => round.diagnostics?.layers?.maxDrawsContentCount),
              maxBackendNodeLayerCountMedian: diagnosticMedian((round) => round.diagnostics?.layers?.maxBackendNodeLayerCount),
              paintedEventsMedian: diagnosticMedian((round) => round.diagnostics?.layers?.paintedEvents),
            }
          : null,
      }
    : null
  return {
    rounds: rounds.length,
    validRounds: valid.length,
    invalidRounds: rounds.length - valid.length,
    fpsMedian: Number(median(valid.map((round) => round.fps)).toFixed(1)),
    fpsMin: valid.length ? Math.min(...valid.map((round) => round.fps)) : 0,
    fpsMax: valid.length ? Math.max(...valid.map((round) => round.fps)) : 0,
    p95Median: Number(median(valid.map((round) => round.p95Ms)).toFixed(2)),
    p99Median: Number(median(valid.map((round) => round.p99Ms)).toFixed(2)),
    maxMsMax: valid.length ? Math.max(...valid.map((round) => round.maxMs)) : 0,
    droppedOver25Median: Number(median(valid.map((round) => round.droppedOver25Ms)).toFixed(1)),
    droppedOver50Median: Number(median(valid.map((round) => round.droppedOver50Ms)).toFixed(1)),
    diagnostics,
  }
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error('缺少 out/main/index.cjs，请先执行 `npm run electron:build`。')
  }
  for (const name of CONFIG_SET) {
    if (CONFIGS[name] === undefined) {
      throw new Error(`未知配置：${name}（可用：${Object.keys(CONFIGS).join(', ')}）`)
    }
  }

  const app = await launchElectronApp({ mainEntry: MAIN_ENTRY, cwd: ROOT })
  const page = app.page
  let fixture = null
  let session = null
  let diagnostics = null

  try {
    await waitForApp(page)
    session = await page.context().newCDPSession(page)
    if (DIAGNOSTICS_ENABLED) {
      await installPageDiagnostics(page)
      diagnostics = await createPanDiagnostics(page, session, {
        layers: LAYER_DIAGNOSTICS_ENABLED,
        listenerTree: LISTENER_TREE_ENABLED,
      })
    }

    // 先清掉可能残留的历史 fixture，再生成本次的
    await removeFixtures(page, FIXTURE_PREFIX)
    const windowSize = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }))
    fixture = await createRealContentFixture(page, {
      sourceProject: SOURCE_PROJECT,
      multiplier: MULTIPLIER,
      tempName: `${FIXTURE_PREFIX}${Date.now()}`,
      viewportPlan: { ...windowSize, sweepScreenDistance: SWEEP_SCREEN_DISTANCE },
    })

    await openFixtureProject(page, fixture.projectName, fixture.nodeCount)
    const environment = await collectEnvironment(page, session)

    const grab = await findPanePoint(page, { preferRatioX: 0.86, preferRatioY: 0.5 })
    if (!grab) throw new Error('找不到落在 .react-flow__pane 上的抓取点')

    // 每轮都从同一个视口出发，否则轮次之间起点会缓慢漂移，数据不可比
    const startViewport = {
      x: fixture.viewport.x,
      y: fixture.viewport.y,
      zoom: fixture.viewport.zoom,
    }
    // 扫掠长度受真实内容长度限制：走出内容范围后测的就是空画布上的 60fps
    const effectiveSweepMs = Math.max(
      500,
      Math.round(Math.min(SWEEP_MS, (fixture.viewport.availableSweepScreenDistance / SWEEP_SPEED_PX_PER_SEC) * 1000))
    )
    const sweepOptions = {
      grab,
      durationMs: effectiveSweepMs,
      dx: -SWEEP_STEP_PX,
      intervalMs: SWEEP_INTERVAL_MS,
    }

    // 预热：冷启动的头几轮永远偏慢，不计入结果
    await applyConfig(page, 'off')
    for (let i = 0; i < 2; i += 1) {
      await sweep(page, session, { ...sweepOptions, measure: false })
      await resetViewport(page, session, startViewport)
    }

    const results = {}
    for (const name of CONFIG_SET) results[name] = []
    const resetFailures = []
    let diagnosticSoak = null

    // 同一次启动内交替采样：A/B/A/B…，避免「第一个配置永远最慢」的预热假象
    for (let rep = 0; rep < REPS; rep += 1) {
      for (const name of CONFIG_SET) {
        await applyConfig(page, name)
        // 不能只相信上一轮的复位结果：起点偏离会让扫掠走进另一条内容密度带，
        // 仍可能通过“至少 5 个可见节点”的弱自检并产出假的高帧率。
        const ready = await resetViewport(page, session, startViewport)
        let recoveredStart = false
        if (!ready.ok) {
          resetFailures.push({ rep: rep + 1, config: name, phase: 'before', reset: ready })
          await recoverFixtureViewport(page, fixture, startViewport)
          recoveredStart = true
          const recovered = await resetViewport(page, session, startViewport)
          if (!recovered.ok) {
            throw new Error(`配置 ${name} 第 ${rep + 1} 轮无法恢复统一起点`)
          }
        }
        const diagnosticStart = diagnostics ? await diagnostics.startRound() : null
        const forward = await sweep(page, session, { ...sweepOptions, measure: true })
        const diagnosticResult = diagnostics ? await diagnostics.endRound(diagnosticStart) : null
        const invalidReasons = recoveredStart
          ? [...forward.invalidReasons, '起点通过重载恢复，本轮包含重新光栅开销']
          : forward.invalidReasons
        results[name].push({
          rep: rep + 1,
          ...forward,
          valid: forward.valid && !recoveredStart,
          invalidReasons,
          diagnostics: diagnosticResult,
        })
        const reset = await resetViewport(page, session, startViewport)
        if (!reset.ok) resetFailures.push({ rep: rep + 1, config: name, reset })
        await sleep(200)
      }
    }
    await applyConfig(page, 'off')

    if (diagnostics && SOAK_REPS > 0) {
      const before = await diagnostics.collectRetainedState()
      const soakResetFailures = []
      for (let rep = 0; rep < SOAK_REPS; rep += 1) {
        await sweep(page, session, { ...sweepOptions, measure: false })
        const reset = await resetViewport(page, session, startViewport)
        if (!reset.ok) soakResetFailures.push({ rep: rep + 1, reset })
      }
      const after = await diagnostics.collectRetainedState()
      diagnosticSoak = {
        reps: SOAK_REPS,
        resetFailures: soakResetFailures,
        retained: diagnostics.diffRetainedState(before, after),
      }
    }

    const summary = {}
    for (const name of CONFIG_SET) summary[name] = summarize(results[name])

    const output = {
      ok: true,
      generatedAt: new Date().toISOString(),
      launchMode: app.mode,
      params: {
        sourceProject: SOURCE_PROJECT,
        multiplier: MULTIPLIER,
        requestedSweepMs: SWEEP_MS,
        effectiveSweepMs,
        sweepSpeedPxPerSec: SWEEP_SPEED_PX_PER_SEC,
        reps: REPS,
        configs: CONFIG_SET,
        diagnostics: DIAGNOSTICS_ENABLED,
        layerDiagnostics: LAYER_DIAGNOSTICS_ENABLED,
        listenerTreeDiagnostics: LISTENER_TREE_ENABLED,
        soakReps: SOAK_REPS,
      },
      fixture: {
        projectName: fixture.projectName,
        nodeCount: fixture.nodeCount,
        edgeCount: fixture.edgeCount,
        nodeTypeCount: fixture.nodeTypeCount,
        nodeTypes: fixture.nodeTypes,
        sourceViewport: fixture.sourceViewport,
        sweepStartViewport: fixture.viewport,
      },
      environment,
      grab,
      resetFailures,
      diagnosticSoak,
      summary,
      rounds: results,
    }

    fs.mkdirSync(OUT_DIR, { recursive: true })
    const outFile = path.join(OUT_DIR, `pan-bench-${Date.now()}.json`)
    fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8')

    console.log(JSON.stringify({ ...output, rounds: undefined }, null, 2))
    console.log(`\n完整数据：${path.relative(ROOT, outFile)}`)
  } finally {
    if (fixture) {
      // 回到项目列表再删，避免正在打开的项目被自动保存重新写回
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click().catch(() => undefined)
      await sleep(800)
      await removeFixtures(page, FIXTURE_PREFIX).catch(() => undefined)
    }
    await diagnostics?.dispose().catch(() => undefined)
    await session?.detach().catch(() => undefined)
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
