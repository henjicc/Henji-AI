'use strict'

/**
 * 画布节点外观与关键几何回归校验。
 *
 * 默认在同一次 Electron 启动、同一临时真实内容 fixture、同一视口内比较：
 *   - off：当前应用样式（基线）
 *   - repeat：再次采集基线，用于证明截图自身稳定
 *   - paintdisabled：只关闭绘制隔离的 contain，供隔离壳落地后做 A/B
 *   - willchange：已知会导致文字发虚的负例；必须被像素检查抓到
 *
 * 环境变量：VISUAL_PROJECT、VISUAL_MULT、VISUAL_SET、VISUAL_OUT、
 * VISUAL_SKIP_ONBOARDING=0（仅在需要检查引导本身时显示）、
 * VISUAL_FILL_ALL_TYPES=1（在临时 fixture 补齐缺失类型）、
 * VISUAL_REQUIRE_ALL_TYPES=1（源项目缺少注册类型时失败）。
 */

const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
const {
  FIXTURE_PREFIX,
  createRealContentFixture,
  removeFixtures,
  resetViewport,
  sleep,
} = require('./lib/canvasPanBench.cjs')
const {
  RASTER_CONTROL_RATIO_LIMIT,
  cropCompare,
  diffBuffers,
  passesRasterControl,
  worstBlock,
} = require('./lib/canvasVisualDiff.cjs')
const {
  ensureVisualSourceProject,
  prepareFullTypeFixture,
  prepareModelSelectorFixture,
} = require('./lib/canvasVisualFixture.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')
const OUT_DIR = path.join(ROOT, process.env.VISUAL_OUT || '.canvas-visual')
const SOURCE_PROJECT = process.env.VISUAL_PROJECT || 'TEST'
const MULTIPLIER = Math.max(1, Number(process.env.VISUAL_MULT || 1))
const SELECTOR_STATE = process.env.VISUAL_SELECTOR_STATE || 'preserve'
const FILL_ALL_TYPES = process.env.VISUAL_FILL_ALL_TYPES === '1'
const SKIP_ONBOARDING = process.env.VISUAL_SKIP_ONBOARDING !== '0'
const STYLE_ID = '__canvas_visual_check_style__'
const CAPTURE_SETTLE_MS = 250

// 与 nodeTypes 唯一注册点保持一致，视觉夹具据此覆盖所有内置节点类型。
const REGISTERED_NODE_TYPES = [
  'universalUploadNode', 'uploadNode', 'imageNode', 'exportImageNode', 'textProcessingNode', 'textAnnotationNode', 'groupNode',
  'storyboardNode', 'storyboardGenNode', 'videoGenNode', 'audioGenNode',
  'exportVideoNode', 'exportAudioNode', 'videoUploadNode', 'audioUploadNode',
  'intSourceNode', 'floatSourceNode', 'stringSourceNode', 'booleanSourceNode',
  'imageModelSelectorNode', 'videoModelSelectorNode', 'audioModelSelectorNode',
  'cameraStageNode',
]

const CONFIGS = {
  off: { css: '', expect: 'pass' },
  repeat: { css: '', expect: 'pass' },
  paintdisabled: {
    css: '.canvas-node-paint-frame{contain:none!important;}.react-flow__node{contain:none!important;overflow-clip-margin:0!important;}',
    expect: 'pass',
  },
  willchange: { css: '.react-flow__viewport{will-change:transform!important;}', expect: 'fail' },
}
const CONFIG_SET = (process.env.VISUAL_SET || 'off,repeat,paintdisabled,willchange')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)

function round(value) {
  return Number(value.toFixed(3))
}

async function applyConfig(page, name) {
  const config = CONFIGS[name]
  if (!config) throw new Error(`未知配置：${name}（可用：${Object.keys(CONFIGS).join(', ')}）`)
  await page.evaluate(({ styleId, css }) => {
    let style = document.getElementById(styleId)
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    // 截图判定只关心静态外观；禁用动画与过渡，排除流动连线和 hover 退场的时序噪声。
    style.textContent = `${css}\n*{animation:none!important;transition:none!important;caret-color:transparent!important;}\n.canvas-processing-edge__flow{display:none!important;}`
    for (const media of document.querySelectorAll('video,audio')) media.pause()
  }, { styleId: STYLE_ID, css: config.css })
  await sleep(CAPTURE_SETTLE_MS)
}

async function openFixtureProject(page, projectName, expectedNodeCount) {
  await page.getByRole('button', { name: /画布|Canvas/ }).click()
  await page.waitForTimeout(600)
  if (await page.locator('.react-flow').count() > 0) {
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await page.waitForTimeout(600)
  }
  await page.getByText(projectName, { exact: true }).click()
  await page.waitForSelector('.react-flow', { timeout: 30000 })
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
    expectedNodeCount,
    { timeout: 40000 }
  )
  await page.waitForTimeout(2500)
}

async function openSyntheticModelPicker(page) {
  const imageSelector = page.locator('[data-id="__visual_source_imageModelSelectorNode"]')
  const trigger = imageSelector.locator('button').filter({ hasText: /KIE/i }).first()
  await trigger.click()
  await page.getByRole('scrollbar', { name: /供应商|provider/i }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(350)
}

async function closeSyntheticModelPicker(page) {
  const imageSelector = page.locator('[data-id="__visual_source_imageModelSelectorNode"]')
  const trigger = imageSelector.locator('button').filter({ hasText: /KIE/i }).first()
  await trigger.click()
  await page.getByRole('scrollbar', { name: /供应商|provider/i }).waitFor({ state: 'hidden', timeout: 10000 })
  await page.waitForTimeout(250)
}

async function lowerSyntheticFixtureViewport(page, fixture) {
  const viewport = { ...fixture.viewport, y: fixture.viewport.y + 120 }
  await page.evaluate(async ({ projectId, viewportJson }) => {
    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET viewport_json = ? WHERE id = ?',
      [viewportJson, projectId]
    )
  }, { projectId: fixture.projectId, viewportJson: JSON.stringify(viewport) })
  return { ...fixture, viewport }
}

async function captureModelPickerScrollbarSpacing(page) {
  return page.evaluate(() => {
    const providerList = document.querySelector('.model-provider-scroll-viewport')
    const thumb = document.querySelector('[data-provider-scroll-thumb]')
    const dividedSection = providerList?.parentElement?.parentElement
    if (!providerList || !thumb || !dividedSection) return null
    const providerRect = providerList.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    const sectionRect = dividedSection.getBoundingClientRect()
    const abovePx = Number((thumbRect.top - providerRect.bottom).toFixed(3))
    const belowPx = Number((sectionRect.bottom - thumbRect.bottom).toFixed(3))
    return {
      abovePx,
      belowPx,
      differencePx: Number(Math.abs(abovePx - belowPx).toFixed(3)),
    }
  })
}

async function captureGeometry(page) {
  return page.evaluate((registeredTypes) => {
    const rounded = (value) => Number(value.toFixed(3))
    const rectJson = (rect) => ({
      left: rounded(rect.left), top: rounded(rect.top), width: rounded(rect.width), height: rounded(rect.height),
    })
    const intersect = (left, right) => {
      const x1 = Math.max(left.left, right.left)
      const y1 = Math.max(left.top, right.top)
      const x2 = Math.min(left.right, right.right)
      const y2 = Math.min(left.bottom, right.bottom)
      return x2 > x1 && y2 > y1 ? { left: x1, top: y1, right: x2, bottom: y2 } : null
    }
    const nodeType = (node) => Array.from(node.classList)
      .find((className) => className.startsWith('react-flow__node-'))
      ?.slice('react-flow__node-'.length) ?? 'unknown'
    const describe = (element) => ({
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
    })
    const visibleClip = (element, root) => {
      let clip = element.getBoundingClientRect()
      for (let current = element; current && current !== root.parentElement; current = current.parentElement) {
        const style = getComputedStyle(current)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null
        const rect = current.getBoundingClientRect()
        const clipsX = style.overflowX !== 'visible'
        const clipsY = style.overflowY !== 'visible'
        if (clipsX || clipsY) {
          const limit = {
            left: clipsX ? rect.left : Number.NEGATIVE_INFINITY,
            right: clipsX ? rect.right : Number.POSITIVE_INFINITY,
            top: clipsY ? rect.top : Number.NEGATIVE_INFINITY,
            bottom: clipsY ? rect.bottom : Number.POSITIVE_INFINITY,
          }
          clip = intersect(clip, limit)
          if (!clip) return null
        }
      }
      return clip
    }
    const viewport = document.querySelector('.react-flow__viewport')
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : null
    const zoom = matrix?.a || 1
    const typeSummary = Object.fromEntries(registeredTypes.map((type) => [type, {
      sampleCount: 0,
      raw: { top: 0, right: 0, bottom: 0, left: 0, element: null },
      painted: { top: 0, right: 0, bottom: 0, left: 0, element: null },
    }]))
    const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map((node) => {
      const rootRect = node.getBoundingClientRect()
      const type = nodeType(node)
      if (!typeSummary[type]) {
        typeSummary[type] = {
          sampleCount: 0,
          raw: { top: 0, right: 0, bottom: 0, left: 0, element: null },
          painted: { top: 0, right: 0, bottom: 0, left: 0, element: null },
        }
      }
      typeSummary[type].sampleCount += 1
      for (const element of node.querySelectorAll('*')) {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        const candidates = [
          ['top', Math.max(0, rootRect.top - rect.top)],
          ['right', Math.max(0, rect.right - rootRect.right)],
          ['bottom', Math.max(0, rect.bottom - rootRect.bottom)],
          ['left', Math.max(0, rootRect.left - rect.left)],
        ]
        for (const [side, screenAmount] of candidates) {
          const amount = rounded(screenAmount / zoom)
          if (amount > typeSummary[type].raw[side]) {
            typeSummary[type].raw[side] = amount
            typeSummary[type].raw.element = describe(element)
          }
        }
        const clipped = visibleClip(element, node)
        if (!clipped) continue
        const paintedCandidates = [
          ['top', Math.max(0, rootRect.top - clipped.top)],
          ['right', Math.max(0, clipped.right - rootRect.right)],
          ['bottom', Math.max(0, clipped.bottom - rootRect.bottom)],
          ['left', Math.max(0, rootRect.left - clipped.left)],
        ]
        for (const [side, screenAmount] of paintedCandidates) {
          const amount = rounded(screenAmount / zoom)
          if (amount > typeSummary[type].painted[side]) {
            typeSummary[type].painted[side] = amount
            typeSummary[type].painted.element = describe(element)
          }
        }
      }
      return { id: node.getAttribute('data-id'), type, rect: rectJson(rootRect) }
    }).sort((left, right) => `${left.id}`.localeCompare(`${right.id}`))
    const minimap = Array.from(document.querySelectorAll('.react-flow__minimap-node')).map((element) => ({
      x: element.getAttribute('x'), y: element.getAttribute('y'),
      width: element.getAttribute('width'), height: element.getAttribute('height'),
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    const edges = Array.from(document.querySelectorAll('.react-flow__edge')).map((edge) => ({
      id: edge.getAttribute('data-id'),
      d: edge.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? null,
    })).sort((left, right) => `${left.id}`.localeCompare(`${right.id}`))
    return { zoom: rounded(zoom), nodes, minimap, edges, typeSummary }
  }, REGISTERED_NODE_TYPES)
}

function compareGeometry(baseline, candidate) {
  const compare = (key) => JSON.stringify(baseline[key]) === JSON.stringify(candidate[key])
  return {
    nodeBoxesEqual: compare('nodes'),
    minimapRectsEqual: compare('minimap'),
    edgePathsEqual: compare('edges'),
  }
}

async function captureFlow(page, filePath) {
  const buffer = await page.locator('.react-flow').screenshot({ animations: 'disabled' })
  fs.writeFileSync(filePath, buffer)
  return buffer
}

async function captureConfig(page, session, name, startViewport, runDir) {
  await applyConfig(page, name)
  const reset = await resetViewport(page, session, startViewport)
  if (!reset.ok) throw new Error(`配置 ${name} 截图前视口复位失败`)
  const geometry = await captureGeometry(page)
  const screenshotPath = path.join(runDir, `${name}.png`)
  const screenshot = await captureFlow(page, screenshotPath)
  return { name, screenshotPath, screenshot, geometry }
}

async function compareCapture(baseline, candidate, runDir) {
  const pixels = await diffBuffers(baseline.screenshot, candidate.screenshot)
  const geometry = compareGeometry(baseline.geometry, candidate.geometry)
  const passed = pixels.changedPct === 0 && pixels.maxDelta <= 2 && Object.values(geometry).every(Boolean)
  let diffCrop = null
  if (!passed) {
    const block = await worstBlock(baseline.screenshot, candidate.screenshot, 180)
    const stem = `${baseline.name}-vs-${candidate.name}`
    diffCrop = await cropCompare(
      baseline.screenshot,
      candidate.screenshot,
      block,
      path.join(runDir, `${stem}-baseline.png`),
      path.join(runDir, `${stem}-candidate.png`)
    )
  }
  return { passed, pixels, geometry, diffCrop }
}

async function captureGestureComparison(page, session, startViewport, runDir) {
  await applyConfig(page, 'off')
  await resetViewport(page, session, startViewport)
  // 直接切换生产代码使用的手势 class，并在同一手势态比较当前样式与关闭 contain 的参考样式。
  // “按住 vs 松手”会包含项目既有的高密度玻璃降级，不能作为本次隔离壳的零差异基线。
  await page.evaluate(() => document.querySelector('.react-flow')?.parentElement?.classList.add('canvas-viewport-moving'))
  await sleep(CAPTURE_SETTLE_MS)
  await captureFlow(page, path.join(runDir, 'gesture-current-warmup.png'))
  const currentPath = path.join(runDir, 'gesture-current.png')
  const current = await captureFlow(page, currentPath)
  const currentGeometry = await captureGeometry(page)
  await page.evaluate(() => document.querySelector('.react-flow')?.parentElement?.classList.remove('canvas-viewport-moving'))

  await applyConfig(page, 'paintdisabled')
  await resetViewport(page, session, startViewport)
  await page.evaluate(() => document.querySelector('.react-flow')?.parentElement?.classList.add('canvas-viewport-moving'))
  await sleep(CAPTURE_SETTLE_MS)
  await captureFlow(page, path.join(runDir, 'gesture-paintdisabled-warmup.png'))
  const referencePath = path.join(runDir, 'gesture-paintdisabled.png')
  const reference = await captureFlow(page, referencePath)
  const referenceGeometry = await captureGeometry(page)
  await page.evaluate(() => document.querySelector('.react-flow')?.parentElement?.classList.remove('canvas-viewport-moving'))
  const comparison = await compareCapture(
    { name: 'gesture-current', screenshot: current, geometry: currentGeometry },
    { name: 'gesture-paintdisabled', screenshot: reference, geometry: referenceGeometry },
    runDir
  )
  await applyConfig(page, 'off')
  await resetViewport(page, session, startViewport)
  return { ...comparison, currentPath, referencePath }
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) throw new Error('缺少 out/main/index.cjs，请先执行 `npm run electron:build`。')
  for (const name of CONFIG_SET) if (!CONFIGS[name]) throw new Error(`未知配置：${name}`)
  if (!CONFIG_SET.includes('off')) throw new Error('VISUAL_SET 必须包含 off 基线')

  const runDir = path.join(OUT_DIR, `canvas-visual-${Date.now()}`)
  fs.mkdirSync(runDir, { recursive: true })
  const app = await launchElectronApp({
    mainEntry: MAIN_ENTRY,
    cwd: ROOT,
    skipOnboarding: SKIP_ONBOARDING,
  })
  const page = app.page
  let fixture = null
  let source = null
  let session = null
  try {
    await waitForApp(page)
    session = await page.context().newCDPSession(page)
    await removeFixtures(page, FIXTURE_PREFIX)
    source = await ensureVisualSourceProject(page, SOURCE_PROJECT, FIXTURE_PREFIX)
    const windowSize = await page.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }))
    fixture = await createRealContentFixture(page, {
      sourceProject: source.sourceProject,
      multiplier: MULTIPLIER,
      tempName: `${FIXTURE_PREFIX}visual_${Date.now()}`,
      viewportPlan: { ...windowSize, sweepScreenDistance: 500 },
    })
    fixture = await prepareModelSelectorFixture(page, fixture, SELECTOR_STATE)
    fixture = await prepareFullTypeFixture(page, fixture, FILL_ALL_TYPES)
    if (source.created) fixture = await lowerSyntheticFixtureViewport(page, fixture)
    await openFixtureProject(page, fixture.projectName, fixture.nodeCount)
    if (source.created) await openSyntheticModelPicker(page)
    const modelPickerScrollbarSpacing = source.created
      ? await captureModelPickerScrollbarSpacing(page)
      : null
    if (source.created) await closeSyntheticModelPicker(page)

    const startViewport = { x: fixture.viewport.x, y: fixture.viewport.y }
    // Chromium 首张截图会触发一次最终光栅，不能把这 3/255 的一次性舍入变化算进基线。
    await applyConfig(page, 'off')
    await resetViewport(page, session, startViewport)
    await captureFlow(page, path.join(runDir, 'warmup.png'))
    const captures = {}
    for (const name of CONFIG_SET) captures[name] = await captureConfig(page, session, name, startViewport, runDir)
    const baseline = captures.off
    const comparisons = {}
    for (const name of CONFIG_SET.filter((item) => item !== 'off')) {
      comparisons[name] = await compareCapture(baseline, captures[name], runDir)
    }
    const gesture = await captureGestureComparison(page, session, startViewport, runDir)
    const presentTypes = Object.entries(baseline.geometry.typeSummary)
      .filter(([, summary]) => summary.sampleCount > 0)
      .map(([type]) => type)
    const missingTypes = REGISTERED_NODE_TYPES.filter((type) => !presentTypes.includes(type))
    const negativeControl = comparisons.willchange
    const expectationResults = Object.fromEntries(Object.entries(comparisons).map(([name, comparison]) => [
      name,
      CONFIGS[name].expect === 'pass'
        ? (name === 'paintdisabled' ? passesRasterControl(comparison, negativeControl) : comparison.passed)
        : !comparison.passed,
    ]))
    const gestureExpectationPassed = passesRasterControl(gesture, negativeControl)
    const coverageOk = process.env.VISUAL_REQUIRE_ALL_TYPES !== '1' || missingTypes.length === 0
    const modelPickerSpacingOk = !modelPickerScrollbarSpacing
      || modelPickerScrollbarSpacing.differencePx <= 1
    const ok = Object.values(expectationResults).every(Boolean)
      && gestureExpectationPassed
      && coverageOk
      && modelPickerSpacingOk
    const output = {
      ok,
      generatedAt: new Date().toISOString(),
      params: {
        sourceProject: SOURCE_PROJECT,
        resolvedSourceProject: source.sourceProject,
        syntheticSourceCreated: source.created,
        syntheticModelPickerOpened: source.created,
        skipOnboarding: SKIP_ONBOARDING,
        multiplier: MULTIPLIER,
        selectorState: SELECTOR_STATE,
        fillAllTypes: FILL_ALL_TYPES,
        configs: CONFIG_SET,
      },
      fixture: { ...fixture, sourceViewport: undefined },
      coverage: {
        registeredTypeCount: REGISTERED_NODE_TYPES.length,
        registeredNodeTypes: REGISTERED_NODE_TYPES,
        presentTypeCount: presentTypes.length,
        presentTypes,
        missingTypes,
      },
      baselineGeometry: baseline.geometry,
      comparisons,
      gesture,
      gestureExpectationPassed,
      rasterCalibration: {
        negativeControl: 'willchange',
        ratioLimit: RASTER_CONTROL_RATIO_LIMIT,
        paintdisabledRatio: negativeControl?.pixels?.changedPct > 0
          ? round(comparisons.paintdisabled.pixels.changedPct / negativeControl.pixels.changedPct)
          : null,
        gestureRatio: negativeControl?.pixels?.changedPct > 0
          ? round(gesture.pixels.changedPct / negativeControl.pixels.changedPct)
          : null,
      },
      modelPickerScrollbarSpacing,
      modelPickerSpacingOk,
      expectationResults,
    }
    const outFile = path.join(runDir, 'result.json')
    fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8')
    console.log(JSON.stringify({
      ok,
      coverage: output.coverage,
      comparisons: Object.fromEntries(Object.entries(comparisons).map(([name, value]) => [name, {
        passed: value.passed, pixels: value.pixels, geometry: value.geometry,
      }])),
      gesture: {
        passed: gesture.passed,
        accepted: gestureExpectationPassed,
        pixels: gesture.pixels,
        geometry: gesture.geometry,
      },
      rasterCalibration: output.rasterCalibration,
      modelPickerScrollbarSpacing,
      modelPickerSpacingOk,
      expectationResults,
      result: path.relative(ROOT, outFile),
    }, null, 2))
    if (!ok) process.exitCode = 1
  } finally {
    if (fixture) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click().catch(() => undefined)
      await sleep(800)
    }
    if (source || fixture) await removeFixtures(page, FIXTURE_PREFIX).catch(() => undefined)
    await session?.detach().catch(() => undefined)
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
