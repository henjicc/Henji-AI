/**
 * 在真实 Electron DOM 上执行可自动判定的界面规则。
 * 截图与主观观感由 ui:tour 负责，本命令只输出规则结论并以退出码作为门禁。
 */
const fs = require('node:fs')
const path = require('node:path')
const { createRuntimeEvidenceCollector, finalizeSceneEvidence } = require('./lib/runtimeEvidence.cjs')
const { UI_AUDIT_RULES, auditUiDom } = require('./lib/uiAuditDom.cjs')
const { auditPageContrast, loadContrastExceptions } = require('./lib/uiContrastAudit.cjs')
const { captureInspectionPage } = require('./lib/uiInspectionCapture.cjs')
const {
  filterScenes,
  formatWindowSize,
  launchUiInspectionApp,
  parseUiInspectionArgs,
  resolveInspectionRuns,
  resolveInspectionScenePool,
  resolveOutputDir,
  selectInspectionScenes,
  themePresetLaunchArgs,
  setInspectionWindowSize,
  assertInspectionWindowSize,
} = require('./lib/uiInspection.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const LOCAL_RULES = UI_AUDIT_RULES.filter((rule) => rule.key !== 'pageTitleInconsistency')

function printHelp() {
  console.log(`Henji-AI 真实 DOM 视觉规则审计

用法：
  npm run check:ui-visual
  npm run check:ui-visual -- --size 960x640
  npm run check:ui-visual -- --only 设置
  npm run check:ui-visual -- --profile real --only 设置
  npm run check:ui-visual -- --out .ui-audit/my-run
  npm run check:ui-visual -- --theme-preset all --only 设置

参数与 ui:tour 相同（--size / --only / --out / --profile / --allow-writes / --theme-preset / --steps / --matrix / --display-point）。
--theme-preset 可重复或逗号分隔，all = 石墨/深海/胶片/纸白；多个预设时每个预设单独启动应用，
结果写到 <输出目录>/<预设>/audit.json。

对比度（lowContrast）按渲染后像素计算：隐藏全部文字与图标截一张只有背景的图，在每个候选区域
取样后合成前景；正文 ≥ 4.5:1，大字与图标 ≥ 3:1。场景中途的 capture() 状态只审对比度，
场景终态审全部规则。合理例外登记在 scripts/ui-visual-contrast-exceptions.json（必须写理由）。

规则通过时退出码为 0；任一规则命中或场景失败时退出码为 1。
`)
}

function createPageTitleIssues(results) {
  const bySurface = new Map()
  for (const result of Object.values(results)) {
    for (const title of result.pageTitles) {
      if (!title.surface) continue
      const key = title.surface
      const current = bySurface.get(key)
      if (!current || current.scene === title.scene) {
        bySurface.set(key, title)
      }
    }
  }
  const titles = [...bySurface.values()]
  const fontSizes = [...new Set(titles.map((title) => title.fontSize))]
  if (titles.length < 2 || fontSizes.length === 1) return []
  return [{
    fontSizes,
    titles: titles.map(({ surface, scene, text, fontSize, fontWeight, lineHeight }) => ({
      surface,
      scene,
      text,
      fontSize,
      fontWeight,
      lineHeight,
    })),
  }]
}

function formatIssue(ruleKey, issue) {
  const formatters = {
    surfaceStacks: (value) => `depth=${value.depth} ${value.chain[0]}`,
    lowContrast: (value) => `${value.kind === 'icon' ? '图标' : '文字'} ${value.ratio}:1（需 ${value.required}）${value.kind === 'icon' ? '' : `${value.size}px `}"${value.text}" ${value.color} 压 ${value.background} ${value.element}`,
    oversizedRadius: (value) => `${value.child}>${value.parent} ${value.element}`,
    shadowOutsideOverlay: (value) => value.element,
    hiddenPositioning: (value) => `${value.position} ${value.element}`,
    insetEscape: (value) => `${value.element} ${value.bounds.join('..')}，期望 ${value.expected.join('..')}`,
    horizontalOverflow: (value) => `${value.reason} ${value.element}`,
    nestedScroll: (value) => `${value.inner} 嵌套于 ${value.outer}`,
    hardTextClip: (value) => `"${value.text}" ${value.scrollWidth}>${value.clientWidth}`,
    smallTargets: (value) => `${value.width}x${value.height} ${value.element}`,
    nestedSameBackground: (value) => `ΔE ${value.deltaE} ${value.element} 在 ${value.container}`,
    menuOptionTruncated: (value) => `"${value.text}" ${value.scrollWidth}>${value.clientWidth} ${value.element}`,
    stackedBands: (value) => `${value.count} 条（顶 ${value.top}px）：${value.bands.join(' / ')}`,
    toolbarWrap: (value) => value.reason === 'items' ? `子项排成 ${value.rows} 行 ${value.element}` : `文字折行 "${value.text}" ${value.element}`,
    shortTextTruncated: (value) => `"${value.text}" ${value.scrollWidth}>${value.clientWidth} ${value.element}`,
    selectedStateWeak: (value) => `ΔE ${value.deltaE} ${value.element} vs ${value.rest}`,
    overlayClipped: (value) => `${value.reason === 'viewport' ? '超出窗口' : '被祖先裁切'} ${value.points}/25 点 [${value.bounds.join(',')}] ${value.element}`,
    pageTitleInconsistency: (value) => value.titles
      .map((title) => `${title.surface}=${title.fontSize}px`)
      .join('，'),
  }
  return formatters[ruleKey]?.(issue) || JSON.stringify(issue)
}

function printSceneResult(name, result) {
  console.log(`\n===== ${name} =====（${result.notes.join('；')}）`)
  for (const rule of LOCAL_RULES) {
    const issues = result[rule.key]
    if (!issues) continue
    console.log(`  ${rule.label}: ${issues.length}`)
    for (const issue of issues.slice(0, 8)) {
      console.log(`    ${formatIssue(rule.key, issue)}`)
    }
  }
}

function countIssues(results, crossScene) {
  let count = crossScene.pageTitleInconsistency.length
  for (const result of Object.values(results)) {
    for (const rule of LOCAL_RULES) {
      count += result[rule.key]?.length ?? 0
    }
  }
  return count
}

async function main() {
  const options = parseUiInspectionArgs(process.argv.slice(2), '.ui-audit')
  if (options.help) {
    printHelp()
    return
  }
  const scenePool = resolveInspectionScenePool(options, ROOT)
  const matchedScenes = filterScenes(scenePool, options.only)
  if (matchedScenes.length === 0) {
    throw new Error(`--only 没有匹配到场景。可用界面：${[...new Set(scenePool.map((scene) => scene.surface))].join('、')}`)
  }
  const selection = selectInspectionScenes(matchedScenes, options)
  const scenes = selection.scenes
  if (scenes.length === 0) {
    throw new Error('匹配场景会写入真实业务数据；如确认允许，请显式传入 --allow-writes')
  }

  const exceptions = loadContrastExceptions()
  const runs = resolveInspectionRuns(options, resolveOutputDir(ROOT, options.outDir))
  const summaries = []
  for (const run of runs) {
    summaries.push(await auditPresetRun({ run, scenes, options, selection, exceptions }))
  }
  if (runs.length > 1) {
    console.log('\n===== 预设汇总 =====')
    for (const summary of summaries) {
      console.log(`  ${summary.themePreset}：命中 ${summary.issueCount}，例外 ${summary.exemptedCount}，场景失败 ${summary.failureCount} → ${summary.reportPath}`)
    }
  }
  const issueCount = summaries.reduce((total, summary) => total + summary.issueCount, 0)
  const failureCount = summaries.reduce((total, summary) => total + summary.failureCount, 0)
  if (issueCount > 0 || failureCount > 0) {
    throw new Error(`视觉规则审计未通过：${issueCount} 个规则命中，${failureCount} 个场景失败`)
  }
}

function emptyRuleResult(notes) {
  return { ...Object.fromEntries(UI_AUDIT_RULES.map((rule) => [rule.key, []])), pageTitles: [], notes }
}

async function auditContrastInto(result, app, targetPage, context) {
  const contrast = await auditPageContrast(targetPage, (page) => captureInspectionPage(app.app, page), context)
  result.lowContrast = contrast.issues
  result.contrastExempted = contrast.exempted
  result.contrastStats = contrast.stats
  result.notes.push(`对比度判定 ${contrast.stats.checked} 项，例外 ${contrast.exempted.length}`)
  return result
}

async function auditPresetRun({ run, scenes, options, selection, exceptions }) {
  const outDir = run.outDir
  fs.mkdirSync(outDir, { recursive: true })
  if (run.themePreset) console.log(`\n######## 主题预设：${run.themePreset} ########`)
  const results = {}
  const failures = []
  const runtimeEvidence = {}
  const app = await launchUiInspectionApp({
    root: ROOT,
    mainEntry: MAIN_ENTRY,
    profile: options.profile,
    readOnly: !options.allowWrites,
    displayPoint: options.displayPoint,
    extraArgs: [
      ...(scenes.length === 1 ? scenes[0].launchArgs ?? [] : []),
      ...themePresetLaunchArgs(run.themePreset),
    ],
    extraEnv: {
      ...(scenes.length === 1 ? scenes[0].launchEnv ?? {} : {}),
      ...(scenes.length === 1 && scenes[0]?.forceGpuInitializationFailure === true
        ? { HENJI_UI_INSPECTION_GPU_INIT_FAILURE: '1' } : {}),
    },
  })
  const collector = createRuntimeEvidenceCollector(app.page)

  try {
    for (const size of run.sizes) {
      const sizeLabel = formatWindowSize(size)
      for (const scene of scenes) {
        const resultKey = `${sizeLabel} / ${scene.name}`
        const contrastContext = { scene: scene.name, themePreset: run.themePreset, exceptions }
        collector.begin(resultKey)
        let sceneFailed = false
        let sceneError = null
        const windowEvidence = { requestedOuter: size, baseline: null, completed: null }
        try {
          windowEvidence.baseline = await setInspectionWindowSize(app, size)
          // 与 ui:tour 同一个 capture 出口：场景中途截图的状态（菜单、悬停、浮窗）在这里做对比度审计。
          const capture = async (suffix, { page: targetPage = app.page } = {}) => {
            if (!/^[a-z0-9-]+$/.test(suffix)) throw new Error(`截图后缀无效：${suffix}`)
            const key = `${resultKey} / ${suffix}`
            const result = await auditContrastInto(emptyRuleResult([`中途状态 ${suffix}，只审对比度`]), app, targetPage, contrastContext)
            results[key] = result
            printSceneResult(key, result)
          }
          // 步骤描述的自动指标只在 ui:tour 里汇总；这里只审规则与对比度
          await scene.setup(app.page, app.app, { capture, recordMetrics: () => undefined, electronApp: app.app,
            requestedWindowSize: size, windowEvidence: windowEvidence.baseline })
          windowEvidence.completed = await assertInspectionWindowSize(app, size, windowEvidence.baseline)
          const result = await app.page.evaluate(auditUiDom, {
            scene: scene.name,
            surface: scene.surface,
          })
          await auditContrastInto(result, app, app.page, contrastContext)
          results[resultKey] = result
          printSceneResult(resultKey, result)
        } catch (error) {
          sceneFailed = true
          sceneError = error
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ name: scene.name, size: sizeLabel, message })
          console.error(`\n✗ ${resultKey}：${message}`)
        }
        // 与 ui:tour 一致：场景撤掉自己留下的夹具，保证 --only 单跑与全量顺序跑看到同一份前置状态。
        if (typeof scene.cleanup === 'function') {
          try {
            await scene.cleanup(app.page)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            failures.push({ name: scene.name, size: sizeLabel, message: `场景清理失败：${message}` })
          }
        }
        try {
          runtimeEvidence[resultKey] = finalizeSceneEvidence(await collector.finish({ expectedLogEvents: scene.expectedLogEvents }), sceneError)
          runtimeEvidence[resultKey].window = windowEvidence
          if (!sceneFailed && !runtimeEvidence[resultKey].passed) {
            const runtimeErrorCount = runtimeEvidence[resultKey].browserErrors.length
              + runtimeEvidence[resultKey].logErrors.length
            failures.push({ name: scene.name, size: sizeLabel, message: `捕获到 ${runtimeErrorCount} 个运行时错误` })
          }
        } catch (error) {
          collector.cancel()
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ name: scene.name, size: sizeLabel, message: `运行时证据查询失败：${message}` })
        }
      }
    }
  } finally {
    collector.dispose()
    await app.close()
  }

  const crossScene = {
    pageTitleInconsistency: createPageTitleIssues(results),
  }
  const titleRule = UI_AUDIT_RULES.find((rule) => rule.key === 'pageTitleInconsistency')
  console.log(`\n===== 跨界面 =====`)
  console.log(`  ${titleRule.label}: ${crossScene.pageTitleInconsistency.length}`)
  for (const issue of crossScene.pageTitleInconsistency) {
    console.log(`    ${formatIssue(titleRule.key, issue)}`)
  }

  const exempted = Object.values(results).flatMap((result) => result.contrastExempted ?? [])
  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      ruleCount: UI_AUDIT_RULES.length,
      sceneCount: Object.keys(results).length,
      failures,
      profile: options.profile,
      themePreset: run.themePreset,
      skippedWriteScenes: selection.blocked.map((scene) => scene.name),
      contrastExceptions: {
        registered: exceptions.map((entry) => entry.id),
        used: [...new Set(exempted.map((item) => item.exception))],
        exempted: exempted.length,
      },
    },
    scenes: results,
    crossScene,
    runtimeEvidence,
  }
  const reportPath = path.join(outDir, 'audit.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  const issueCount = countIssues(results, crossScene)
  console.log(`\n审计报告：${reportPath}`)
  console.log(`规则：${UI_AUDIT_RULES.length} 条；命中：${issueCount}；对比度例外：${exempted.length}；场景失败：${failures.length}`)
  return { themePreset: run.themePreset ?? 'default', issueCount, exemptedCount: exempted.length, failureCount: failures.length, reportPath }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
