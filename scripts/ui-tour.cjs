/**
 * 真实 Electron 界面截图巡检。
 *
 * 这个命令只负责产出供人查看的截图与 Markdown 索引，不把像素差异作为 CI 门禁。
 * --audit 同步执行 DOM 与像素规则；check:ui-visual 复用这个循环。
 *
 * 界面核对（skill henji-ui-surface references/review.md）也走这里：`--steps` 用一份步骤描述
 * 驱动“进入 → 动作 → 等待稳定 → 截图（+自动指标）”，`--matrix review` 展开四预设 + 960，
 * `--contrast` 对每张截图做像素对比度审计，结果写进同一个输出目录。
 */
const fs = require('node:fs')
const path = require('node:path')
const { UI_AUDIT_RULES } = require('./lib/uiAuditDom.cjs')
const { auditPageRules } = require('./lib/uiLayoutAudit.cjs')
const { missingScrollCoverage } = require('./lib/uiScrollCoverage.cjs')
const { createPageTitleIssues, countIssues } = require('./lib/uiAuditReport.cjs')
const { captureInspectionPage } = require('./lib/uiInspectionCapture.cjs')
const { auditPageContrast, loadContrastExceptions } = require('./lib/uiContrastAudit.cjs')
const { createRuntimeEvidenceCollector, finalizeSceneEvidence } = require('./lib/runtimeEvidence.cjs')
const { renderVariantSummary, summarizeVariantMetrics } = require('./lib/uiReviewSummary.cjs')
const {
  filterScenes,
  partitionLaunchBatches,
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
  assertReviewCapture,
} = require('./lib/uiInspection.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')

function printHelp() {
  console.log(`Henji-AI 真实界面截图巡检

用法：
  npm run ui:tour
  npm run ui:tour -- --size 1440x900
  npm run ui:tour -- --only 生成
  npm run ui:tour -- --profile real --only 设置
  npm run ui:tour -- --out .ui-tour/my-run
  npm run ui:tour -- --theme-preset all --size 1440x900 --out .ui-tour/presets
  npm run ui:tour -- --steps scripts/ui-review/generation-seedance-kie.json --matrix review --contrast

参数：
  --size <宽x高>  指定窗口尺寸；可重复或用逗号分隔，默认只跑 1440x900；尺寸相关问题再加 960x640
  --only <关键词> 只运行 id、界面或场景名包含关键词的场景；=场景id 只选择该场景
  --out <目录>    输出目录，默认 .ui-tour
  --profile <模式> temporary（默认，隔离临时数据）或 real（复用真实工程、配置与密钥）
  --real-data     --profile real 的别名
  --theme-preset <预设> 本次启动临时使用主题预设（graphite/ocean/film/paper，或 all），经开发启动参数传给应用，
                  不写入设置；可重复或逗号分隔，多个预设时逐个启动应用，截图写到 <输出目录>/<预设>/，
                  输出目录下另有汇总 index.md
  --allow-writes  real 模式下允许运行会写业务数据的场景；不传则自动跳过
  --steps <文件>  改为运行步骤描述（JSON / cjs，可重复或逗号分隔），格式见 skill henji-ui-surface
                  references/review.md 第 6 节，样例在 scripts/ui-review/
  --matrix <名>   核对矩阵：review = 石墨 1440+960、深海/胶片/纸白 1440；screen = 石墨 1440+960。
                  与 --size / --theme-preset 互斥
  --audit         同一次巡检产出 audit.json、截图及运行时证据，规则命中时失败
  --rules         快速检查：每张截图只跑 DOM 规则（遮挡、裁切、截断、折行……），不做像素对比度；命中同样让巡检失败
  --no-screenshots 与 --audit / --rules 同用：照常截图做像素与 DOM 审计，但只把有规则命中、对比度问题或场景失败的截图落盘；
                  日常审计用它，像素基线（check:ui-gallery-diff）与需要目视全量时不加
  --contrast      对每张截图（含场景中途截图）做像素对比度审计，结果写 contrast.json 并汇总进 index.md
  --display-point <x,y|none> 测试窗口放到哪块显示器；默认取 HENJI_DEV_DISPLAY_POINT，未设置时用本机副屏 2561,1
`)
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function createIndex(rows, failures, metadata) {
  const lines = [
    '# Henji-AI 界面巡检截图',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 截图数量：${rows.length}`,
    `- 失败数量：${failures.length}`,
    `- 数据模式：${metadata.profile === 'real' ? '真实用户数据' : '隔离临时数据'}`,
    ...(metadata.themePreset ? [`- 主题预设：${metadata.themePreset}（开发启动参数，未写入设置）`] : []),
    ...(metadata.contrast ? [`- 对比度审计：${metadata.contrast.issueCount} 处不达标，${metadata.contrast.exempted} 处登记例外（详见 contrast.json）`] : []),
    ...(metadata.variantSummary ? [`- 数据变体：${metadata.variantSummary.rows} 行（变体 × 尺寸），可疑 ${metadata.variantSummary.suspicious} 行（详见 [variants.md](variants.md)）`] : []),
    ...(metadata.metrics.length ? [`- 自动指标：${metadata.metrics.length} 项，可疑 ${metadata.metrics.filter((item) => item.metrics.suspicious).length} 项（详见 metrics.json）`] : []),
    `- 结构化日志：通过应用查询接口按场景起始时间截取`,
    '',
    '| 界面 | 场景 | 窗口尺寸 | 截图 |',
    '|---|---|---:|---|',
  ]
  for (const row of rows) {
    lines.push(`| ${markdownEscape(row.surface)} | ${markdownEscape(row.name)} | ${row.size} | [打开截图](${row.file}) |`)
  }
  // DOM 规则命中（重要记录 020）：遮挡、裁切、截断、折行等按截图列出，先看这些；完整结果在 audit.json
  const ruleHits = Object.entries(metadata.rules ?? {}).flatMap(([key, result]) => UI_AUDIT_RULES
    .filter((rule) => rule.key !== 'lowContrast').flatMap((rule) => (result[rule.key] ?? []).map((item) => ({ key, rule, item }))))
  if (ruleHits.length > 0) {
    lines.push('', `## DOM 规则命中（${ruleHits.length} 处，先看这些）`, '', '| 截图 | 规则 | 元素 | 说明 |', '|---|---|---|---|')
    for (const { key, rule, item } of ruleHits.slice(0, 120)) {
      const detail = [item.by && `由 ${item.by}`, item.detail, item.text && `“${item.text}”`, item.outliers?.length && `不合群：${item.outliers.join('、')}`].filter(Boolean).join('，')
      lines.push(`| ${markdownEscape(key)} | ${rule.label} | ${markdownEscape(item.element ?? JSON.stringify(item).slice(0, 80))} | ${markdownEscape(detail)} |`)
    }
    if (ruleHits.length > 120) lines.push('', `（其余 ${ruleHits.length - 120} 处见 audit.json）`)
  }
  const suspicious = metadata.metrics.filter((item) => item.metrics.suspicious)
  if (suspicious.length > 0) {
    lines.push('', '## 自动指标可疑项（先看这些截图）', '', '| 尺寸 | 场景 | 截图后缀 | 行数 | 原因 |', '|---|---|---|---:|---|')
    for (const item of suspicious) {
      lines.push(`| ${item.size} | ${markdownEscape(item.scene)} | ${item.suffix} | ${item.metrics.rows} | ${markdownEscape(item.metrics.reasons.join('；'))} |`)
    }
  }
  if (metadata.contrast?.issueCount > 0) {
    lines.push('', '## 对比度不达标', '')
    for (const [key, result] of Object.entries(metadata.contrast.results)) {
      for (const issue of result.issues.slice(0, 8)) {
        lines.push(`- ${markdownEscape(key)}：${issue.kind === 'icon' ? '图标' : '文字'} ${issue.ratio}:1（需 ${issue.required}）"${markdownEscape(issue.text ?? '')}" ${markdownEscape(issue.element ?? '')}`)
      }
    }
  }
  if (failures.length > 0) {
    lines.push('', '## 失败场景', '')
    for (const failure of failures) {
      lines.push(`- ${failure.size} / ${failure.name}：${markdownEscape(failure.message)}`)
    }
  }
  if (metadata.blocked.length > 0) {
    lines.push('', '## 因写入保护跳过', '')
    for (const scene of metadata.blocked) lines.push(`- ${scene.name}`)
  }
  return `${lines.join('\n')}\n`
}

async function main(argv = process.argv.slice(2), defaultOutDir = '.ui-tour') {
  const options = parseUiInspectionArgs(argv, defaultOutDir)
  if (options.audit && !options.rulesOnly) options.contrast = true
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

  const rootDir = resolveOutputDir(ROOT, options.outDir)
  const runs = resolveInspectionRuns(options, rootDir)
  const exceptions = options.contrast ? loadContrastExceptions() : []
  const summaries = []
  for (const run of runs) {
    summaries.push(await tourPresetRun({ run, scenes, options, selection, exceptions }))
  }
  if (runs.length > 1) {
    const lines = ['# Henji-AI 多预设界面巡检', '', `- 生成时间：${new Date().toISOString()}`, '',
      '| 预设 | 尺寸 | 截图 | 失败 | 指标可疑 | 对比度问题 | 索引 |', '|---|---|---:|---:|---:|---:|---|']
    for (const summary of summaries) {
      lines.push(`| ${summary.themePreset} | ${summary.sizes} | ${summary.rows} | ${summary.failures} | ${summary.suspicious} | ${summary.contrastIssues ?? '—'} | [打开](${summary.themePreset}/index.md) |`)
    }
    fs.writeFileSync(path.join(rootDir, 'index.md'), `${lines.join('\n')}\n`, 'utf8')
    console.log(`\n多预设索引：${path.join(rootDir, 'index.md')}`)
  }
  const failureCount = summaries.reduce((total, summary) => total + summary.failures, 0)
  const issueCount = summaries.reduce((total, summary) => total + (summary.issueCount ?? 0), 0)
  if (issueCount > 0) throw new Error(`视觉规则审计未通过：${issueCount} 个规则命中，${failureCount} 个场景失败`)
  if (failureCount > 0) {
    throw new Error(`${failureCount} 个场景未能完成，已保留成功截图和失败索引`)
  }
}

async function tourPresetRun({ run, scenes, options, selection, exceptions }) {
  const outDir = run.outDir
  fs.mkdirSync(outDir, { recursive: true })
  if (run.themePreset) console.log(`\n######## 主题预设：${run.themePreset} ########`)
  const rows = []
  const failures = []
  const evidence = {}
  const metrics = []
  const contrastResults = {}
  const ruleResults = {}
  // 带启动参数 / 环境变量 / GPU 初始化失败注入 / 启动位置检查的场景各自单独启动一次应用（5.8）：
  // 这些设置只对整个进程生效，与其他场景同进程跑时不会注入，场景必然失败。
  for (const batch of partitionLaunchBatches(scenes)) {
    const app = await launchUiInspectionApp({
      root: ROOT,
      mainEntry: MAIN_ENTRY,
      profile: options.profile,
      readOnly: !options.allowWrites,
      displayPoint: options.displayPoint,
      extraArgs: [
        ...(batch.length === 1 ? batch[0].launchArgs ?? [] : []),
        ...themePresetLaunchArgs(run.themePreset),
      ],
      extraEnv: {
        ...(batch.length === 1 ? batch[0].launchEnv ?? {} : {}),
        ...(batch.length === 1 && batch[0]?.forceGpuInitializationFailure === true
          ? { HENJI_UI_INSPECTION_GPU_INIT_FAILURE: '1' } : {}),
      },
    })
    const collector = createRuntimeEvidenceCollector(app.page)
    let launchInspected = false

    // 截图已落盘后再审：审计会临时隐藏文字取背景，不能影响截图本身
    const auditContrast = async (key, targetPage, scene, final = false) => {
      if (!options.contrast && !options.audit) return
      // --rules 时不做像素对比度（慢），只跑 DOM 规则
      const result = options.contrast ? await auditPageContrast(targetPage, (page) => captureInspectionPage(app.app, page), {
        scene: scene.name, themePreset: run.themePreset, exceptions,
      }) : { issues: [], exempted: [], stats: null }
      if (options.contrast) contrastResults[key] = { issues: result.issues, exempted: result.exempted, stats: result.stats }
      // DOM 规则对每张截图都审（重要记录 020）：此前只审场景终态，中途打开的面板、浮层与状态从没被 DOM 规则看过。
      if (options.audit) {
        const rules = await auditPageRules(targetPage, { scene: scene.name, surface: scene.surface })
        ruleResults[key] = { ...rules, lowContrast: result.issues, contrastExempted: result.exempted, contrastStats: result.stats }
      }
      if (result.issues.length) console.error(`  对比度不达标 ${result.issues.length} 处：${key}`)
    }
    // --no-screenshots：截图先留在内存，审计后只落盘有问题的那张；场景失败时整场景落盘便于排查。
    const hasIssues = key => Boolean(contrastResults[key]?.issues.length
      || (ruleResults[key] && UI_AUDIT_RULES.some(rule => ruleResults[key][rule.key]?.length)))
    let pending = []
    const persist = (item) => {
      fs.writeFileSync(path.join(outDir, item.row.file), item.bytes)
      rows.push(item.row)
    }
    const settle = (item) => {
      if (options.screenshots !== false || hasIssues(item.key)) persist(item)
      else pending.push(item)
    }

    try {
      for (const size of run.sizes) {
        const sizeLabel = formatWindowSize(size)
        for (const scene of batch) {
          const evidenceKey = `${sizeLabel} / ${scene.name}`
          collector.begin(evidenceKey)
          let sceneFailed = false
          let sceneError = null
          const windowEvidence = { requestedOuter: size, baseline: null, completed: null, captures: [] }
          pending = []
          const scrollCaptures = []
          try {
            // 启动位置必须在巡检主动居中/调整尺寸之前检查，而且每次进程只检查一次。
            if (!launchInspected && batch.length === 1 && scene.inspectLaunch) {
              launchInspected = true
              windowEvidence.launch = await scene.inspectLaunch(app.app, app.page)
            }
            windowEvidence.baseline = await setInspectionWindowSize(app, size)
            // 默认截主窗口；`{ page }` 截场景打开的其他窗口（日志窗口、剪辑浮窗），同样进本次输出目录与索引。
            const capture = async (suffix, { page: targetPage = app.page } = {}) => {
              if (!/^[a-z0-9-]+$/.test(suffix)) throw new Error(`截图后缀无效：${suffix}`)
              const fileName = `${sizeLabel}-${scene.id}-${suffix}.png`
              const actual = await assertInspectionWindowSize(app, size, windowEvidence.baseline)
              let pixels
              const clip = scene.captureRegion ? await targetPage.locator(scene.captureRegion).boundingBox() : undefined
              if (scene.captureRegion && !clip) throw new Error(`截图区域不可见：${scene.captureRegion}`)
              const bytes = await captureInspectionPage(app.app, targetPage, { clip, onEvidence: (value) => { pixels = value } })
              const shot = { key: `${evidenceKey} / ${suffix}`, bytes, row: { ...scene, name: `${scene.name}-${suffix}${scene.reviewCapture === suffix ? '（审查主图）' : ''}`, size: sizeLabel, file: fileName } }
              if (options.screenshots !== false) persist(shot)
              await assertInspectionWindowSize(app, size, windowEvidence.baseline)
              windowEvidence.captures.push({ suffix, ...actual, pixels, window: targetPage === app.page ? 'main' : 'secondary' })
              if (scene.scrollCoverage) {
                const measured = await auditPageRules(targetPage)
                const regions = await targetPage.locator(scene.scrollCoverage).evaluateAll(elements => elements.map((element, index) => ({
                  element: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : `:${index}`),
                  id: element.getAttribute('data-ui-scroll-key') || element.querySelector('[data-gallery-section]')?.getAttribute('data-gallery-section') || '',
                  scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                  visibleOffset: Math.max(0, -element.getBoundingClientRect().top),
                  visibleHeight: Math.max(0, Math.min(element.getBoundingClientRect().bottom, innerHeight) - Math.max(element.getBoundingClientRect().top, 0)),
                })))
                if (!regions.length) throw new Error(`完整截图的滚动区域不存在：${scene.scrollCoverage}`)
                scrollCaptures.push(regions)
                windowEvidence.captures.at(-1).scrollRegions = measured.scrollRegions
                const failedSamples = measured.gallerySamples.filter(sample => !sample.passed)
                if (failedSamples.length) throw new Error(`样张规则断牙失败：${failedSamples.map(sample => sample.id).join(', ')}`)
              }
              await auditContrast(`${evidenceKey} / ${suffix}`, targetPage, scene)
              if (options.screenshots === false) settle(shot)
            }
            // 步骤描述的自动指标（行数、溢出、截断）；普通场景不调用
            const recordMetrics = ({ suffix, variant, metrics: value }) => {
              metrics.push({ size: sizeLabel, scene: scene.name, sceneId: scene.id, suffix, variant,
                file: `${sizeLabel}-${scene.id}-${suffix}.png`, metrics: value })
              if (value.suspicious) console.log(`  ! ${suffix}：${value.reasons.join('；')}`)
            }
            // 尺寸扫描（sweepLayout）逐档只跑 DOM 规则不截图：命中的档位才截图并计入规则结果
            const auditRules = async (targetPage = app.page) => auditPageRules(targetPage, { scene: scene.name, surface: scene.surface })
            const recordRules = (suffix, rules) => { ruleResults[`${evidenceKey} / ${suffix}`] = rules }
            await scene.setup(app.page, app.app, { capture, recordMetrics, auditRules, recordRules, setWindowSize: async (value) => setInspectionWindowSize(app, value), electronApp: app.app,
              requestedWindowSize: size, windowEvidence: windowEvidence.baseline })
            assertReviewCapture(scene, windowEvidence.captures)
            const missing = missingScrollCoverage(scrollCaptures)
            if (missing.length) throw new Error(`滚动内容漏截：${JSON.stringify(missing)}`)
            const fileName = `${sizeLabel}-${scene.id}.png`
            windowEvidence.completed = await assertInspectionWindowSize(app, size, windowEvidence.baseline)
            let pixels
            const clip = scene.captureRegion ? await app.page.locator(scene.captureRegion).boundingBox() : undefined
            if (scene.captureRegion && !clip) throw new Error(`截图区域不可见：${scene.captureRegion}`)
            const bytes = await captureInspectionPage(app.app, app.page, { clip, onEvidence: (value) => { pixels = value } })
            const finalShot = { key: evidenceKey, bytes, row: { ...scene, name: `${scene.name}${scene.reviewCapture ? '（辅助终态）' : ''}`, size: sizeLabel, file: fileName } }
            if (options.screenshots !== false) persist(finalShot)
            await assertInspectionWindowSize(app, size, windowEvidence.baseline)
            windowEvidence.captures.push({ suffix: 'final', ...windowEvidence.completed,
              pixels })
            await auditContrast(evidenceKey, app.page, scene, true)
            if (options.screenshots === false) settle(finalShot)
            console.log(`✓ ${sizeLabel} / ${scene.name}`)
          } catch (error) {
            sceneFailed = true
            sceneError = error
            for (const item of pending) persist(item)
            pending = []
            // 失败那一刻的画面：步骤找不到目标时，一眼看出界面停在哪里（定位过期步骤还是真缺陷）
            try {
              const bytes = await captureInspectionPage(app.app, app.page, {})
              persist({ key: `${evidenceKey} / failed`, bytes, row: { ...scene, name: `${scene.name}（失败时画面）`, size: sizeLabel, file: `${sizeLabel}-${scene.id}-failed.png` } })
            } catch { /* 窗口已关闭等情况：只记文字原因 */ }
            const message = error instanceof Error ? error.message : String(error)
            failures.push({ name: scene.name, size: sizeLabel, message })
            console.error(`✗ ${sizeLabel} / ${scene.name}：${message}`)
          }
          // 场景在同一份隔离资料里顺序运行；截图后由场景撤掉自己留下的夹具，
          // 保证 --only 单跑与全量顺序跑看到的是同一份前置状态。
          if (typeof scene.cleanup === 'function') {
            try {
              await scene.cleanup(app.page)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              failures.push({ name: scene.name, size: sizeLabel, message: `场景清理失败：${message}` })
              console.error(`✗ ${sizeLabel} / ${scene.name}：场景清理失败：${message}`)
            }
          }
          try {
            evidence[evidenceKey] = finalizeSceneEvidence(await collector.finish({ expectedLogEvents: scene.expectedLogEvents, expectedBrowserErrors: scene.expectedBrowserErrors }), sceneError)
            evidence[evidenceKey].window = windowEvidence
            if (!sceneFailed && !evidence[evidenceKey].passed) {
              const runtimeErrorCount = evidence[evidenceKey].browserErrors.length + evidence[evidenceKey].logErrors.length
              failures.push({ name: scene.name, size: sizeLabel, message: `捕获到 ${runtimeErrorCount} 个运行时错误，详见 evidence.json` })
              console.error(`✗ ${sizeLabel} / ${scene.name}：捕获到 ${runtimeErrorCount} 个运行时错误`)
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
  }

  const contrast = options.contrast ? {
    issueCount: Object.values(contrastResults).reduce((total, result) => total + result.issues.length, 0),
    exempted: Object.values(contrastResults).reduce((total, result) => total + result.exempted.length, 0),
    results: contrastResults,
  } : null
  const metadata = { profile: options.profile, themePreset: run.themePreset, blocked: selection.blocked,
    displayPoint: options.displayPoint, steps: options.steps, metrics, contrast, rules: options.audit ? ruleResults : null }
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify({ metadata: { ...metadata, metrics: undefined, contrast: undefined, rules: undefined }, scenes: evidence }, null, 2), 'utf8')
  if (metrics.length) fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf8')
  // 数据变体（如全部模型）：按“变体 × 尺寸”汇总可疑清单
  if (metrics.some((item) => item.variant)) {
    const captured = new Set(rows.map((row) => row.file))
    const summary = summarizeVariantMetrics(metrics.filter((item) => item.variant), { captured })
    fs.writeFileSync(path.join(outDir, 'variants.md'), `# 数据变体汇总\n\n${renderVariantSummary(summary)}`, 'utf8')
    metadata.variantSummary = { rows: summary.length, suspicious: summary.filter((row) => row.suspicious).length }
  }
  if (contrast) fs.writeFileSync(path.join(outDir, 'contrast.json'), JSON.stringify(contrast, null, 2), 'utf8')
  let issueCount = 0
  if (options.audit) {
    const crossScene = { pageTitleInconsistency: createPageTitleIssues(ruleResults) }
    issueCount = countIssues(ruleResults, crossScene)
    const exempted = Object.values(ruleResults).flatMap(result => result.contrastExempted ?? [])
    fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ metadata: {
      generatedAt: new Date().toISOString(), ruleCount: UI_AUDIT_RULES.length, sceneCount: Object.keys(ruleResults).length,
      failures, profile: options.profile, themePreset: run.themePreset, skippedWriteScenes: selection.blocked.map(scene => scene.name),
      contrastExceptions: { registered: exceptions.map(entry => entry.id), used: [...new Set(exempted.map(item => item.exception))], exempted: exempted.length },
    }, scenes: ruleResults, crossScene, runtimeEvidence: evidence }, null, 2), 'utf8')
  }
  const index = createIndex(rows, failures, metadata)
  const indexPath = path.join(outDir, 'index.md')
  fs.writeFileSync(indexPath, index, 'utf8')
  console.log(`\n截图目录：${outDir}`)
  console.log(`索引文件：${indexPath}\n`)
  console.log(index)
  return { themePreset: run.themePreset ?? 'default', sizes: run.sizes.map(formatWindowSize).join('、'),
    rows: rows.length, failures: failures.length, suspicious: metrics.filter((item) => item.metrics.suspicious).length,
    contrastIssues: contrast?.issueCount ?? null, issueCount }
}

module.exports = { main }
if (require.main === module) main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
