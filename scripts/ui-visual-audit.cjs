/**
 * 在真实 Electron DOM 上执行可自动判定的界面规则。
 * 截图与主观观感由 ui:tour 负责，本命令只输出规则结论并以退出码作为门禁。
 */
const fs = require('node:fs')
const path = require('node:path')
const { UI_AUDIT_RULES, auditUiDom } = require('./lib/uiAuditDom.cjs')
const {
  UI_INSPECTION_SCENES,
  filterScenes,
  formatWindowSize,
  launchUiInspectionApp,
  parseUiInspectionArgs,
  resolveOutputDir,
  setInspectionWindowSize,
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
  npm run check:ui-visual -- --out .ui-audit/my-run

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
    lowContrast: (value) => `${value.ratio}:1（需 ${value.required}）${value.size}px "${value.text}"`,
    oversizedRadius: (value) => `${value.child}>${value.parent} ${value.element}`,
    shadowOutsideOverlay: (value) => value.element,
    hiddenPositioning: (value) => `${value.position} ${value.element}`,
    insetEscape: (value) => `${value.element} ${value.bounds.join('..')}，期望 ${value.expected.join('..')}`,
    horizontalOverflow: (value) => `${value.reason} ${value.element}`,
    nestedScroll: (value) => `${value.inner} 嵌套于 ${value.outer}`,
    hardTextClip: (value) => `"${value.text}" ${value.scrollWidth}>${value.clientWidth}`,
    smallTargets: (value) => `${value.width}x${value.height} ${value.element}`,
    pageTitleInconsistency: (value) => value.titles
      .map((title) => `${title.surface}=${title.fontSize}px`)
      .join('，'),
  }
  return formatters[ruleKey]?.(issue) || JSON.stringify(issue)
}

function printSceneResult(name, result) {
  console.log(`\n===== ${name} =====（${result.notes[0]}）`)
  for (const rule of LOCAL_RULES) {
    const issues = result[rule.key]
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
      count += result[rule.key].length
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
  const scenes = filterScenes(UI_INSPECTION_SCENES, options.only)
  if (scenes.length === 0) {
    throw new Error(`--only 没有匹配到场景。可用界面：${[...new Set(UI_INSPECTION_SCENES.map((scene) => scene.surface))].join('、')}`)
  }

  const outDir = resolveOutputDir(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const results = {}
  const failures = []
  const app = await launchUiInspectionApp({ root: ROOT, mainEntry: MAIN_ENTRY })

  try {
    for (const size of options.sizes) {
      await setInspectionWindowSize(app, size)
      const sizeLabel = formatWindowSize(size)
      for (const scene of scenes) {
        const resultKey = `${sizeLabel} / ${scene.name}`
        try {
          await scene.setup(app.page)
          const result = await app.page.evaluate(auditUiDom, {
            scene: scene.name,
            surface: scene.surface,
          })
          results[resultKey] = result
          printSceneResult(resultKey, result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ name: scene.name, size: sizeLabel, message })
          console.error(`\n✗ ${resultKey}：${message}`)
        }
      }
    }
  } finally {
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

  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      ruleCount: UI_AUDIT_RULES.length,
      sceneCount: Object.keys(results).length,
      failures,
    },
    scenes: results,
    crossScene,
  }
  const reportPath = path.join(outDir, 'audit.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  const issueCount = countIssues(results, crossScene)
  console.log(`\n审计报告：${reportPath}`)
  console.log(`规则：${UI_AUDIT_RULES.length} 条；命中：${issueCount}；场景失败：${failures.length}`)

  if (issueCount > 0 || failures.length > 0) {
    throw new Error(`视觉规则审计未通过：${issueCount} 个规则命中，${failures.length} 个场景失败`)
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
