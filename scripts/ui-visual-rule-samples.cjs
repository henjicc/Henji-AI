/**
 * 真实 Electron 断牙验证：打开中心页“规范”的正式组件 Do/Don't，逐样本滚动并对账。
 * 需要 HENJI_BUNDLE_MODE=development 的巡检产物；复用正式隔离启动器，不写真实用户资料。
 * Linux 日常规则判据由 test:ui-dom-rules 验证，本命令属于显式窗口验收。
 */
const path = require('node:path')
const { auditPageRules } = require('./lib/uiLayoutAudit.cjs')
const { launchUiInspectionApp, setInspectionWindowSize } = require('./lib/uiInspection.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')

async function main() {
  const displayPoint = process.env.HENJI_DEV_DISPLAY_POINT || null
  const app = await launchUiInspectionApp({ root: ROOT, mainEntry: MAIN_ENTRY, displayPoint, extraArgs: ['--dev-surface=dev.ui_gallery'] })
  try {
    await setInspectionWindowSize(app, { width: 1440, height: 900 })
    await app.page.locator('[data-gallery-nav="rules"]').click()
    const samples = app.page.locator('[data-gallery-rule-sample]')
    await samples.first().waitFor({ state: 'attached' })
    const ids = await samples.evaluateAll(elements => elements.map(element => element.id))
    if (ids.length !== 22) throw new Error(`真实组件样例应为22项，实际${ids.length}`)
    const rows = []
    for (const id of ids) {
      // 居中滚入：贴着视口底边时分数 DPI 会让外框多出零点几像素，样例被当成没完整进入视口
      await app.page.locator(`#${id}`).evaluate(element => element.scrollIntoView({ block: 'center' }))
      await app.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
      await app.page.mouse.move(1, 1)
      const result = await auditPageRules(app.page, { includeGallerySamples: true })
      const sample = result.gallerySamples.find(row => row.id === id)
      if (!sample) throw new Error(`样例未完整进入视口：${id}`)
      rows.push({ ...sample, expect: sample.expectHit ? 'hit' : 'clean', hit: sample.issues.length > 0, note: '中心页正式组件' })
    }
    console.log('check:ui-visual 新规则断牙样例（真实 Electron）')
    for (const row of rows) {
      console.log(`  ${row.passed ? '通过' : '失败'}  ${row.rule.padEnd(18)} ${row.expect === 'hit' ? '应命中' : '应放行'}  ${row.id}：${row.note}${row.hit ? `（命中 ${row.issues.length}）` : ''}`)
      if (!row.passed && row.issues.length) console.log(`        ${JSON.stringify(row.issues[0]).slice(0, 240)}`)
    }
    const failed = rows.filter((row) => !row.passed)
    const rules = [...new Set(rows.map((sample) => sample.rule))]
    console.log(`\n规则 ${rules.length} 条，样例 ${rows.length} 个，失败 ${failed.length} 个`)
    if (failed.length) process.exitCode = 1
  } finally {
    await app.close()
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  process.exitCode = 1
})
