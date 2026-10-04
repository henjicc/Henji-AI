/**
 * check:ui-visual 新规则的断牙验证（任务 5.8）：在真实 Electron 窗口里注入“未修复 / 已修复”样例，
 * 跑与 check:ui-visual 同一个 auditUiDom，逐条核对：未修复样例必须命中、已修复样例不得命中。
 *
 *   npm run test:ui-visual-rules            # 需要 out/ 下的 Electron 产物（npm run electron:bundle）
 *
 * 应用自己的界面不误报由 check:ui-visual 的场景负责；这里只证明判据能抓到问题、对正确写法不出声。
 * 隔离资料、只读，不发任何网络请求。
 */
const path = require('node:path')
const { auditUiDom } = require('./lib/uiAuditDom.cjs')
const { UI_VISUAL_RULE_SAMPLES, buildSampleHostHtml, reconcileSampleIssues } = require('./lib/uiVisualRuleSamples.cjs')
const { launchUiInspectionApp, setInspectionWindowSize } = require('./lib/uiInspection.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')
const HOST_ID = 'ui-visual-rule-samples-host'

async function main() {
  const displayPoint = process.env.HENJI_DEV_DISPLAY_POINT || null
  const app = await launchUiInspectionApp({ root: ROOT, mainEntry: MAIN_ENTRY, displayPoint })
  try {
    await setInspectionWindowSize(app, { width: 1440, height: 900 })
    await app.page.evaluate(({ hostId, html }) => {
      document.getElementById(hostId)?.remove()
      const host = document.createElement('div')
      host.id = hostId
      host.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;overflow:hidden;background:#fff;'
        + 'display:flex;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:24px;padding:24px')
      host.innerHTML = html
      document.body.appendChild(host)
    }, { hostId: HOST_ID, html: buildSampleHostHtml() })
    await app.page.mouse.move(1, 1)
    await app.page.waitForTimeout(200)
    const result = await app.page.evaluate(auditUiDom, { scene: '规则断牙样例', surface: '样例' })
    const rows = reconcileSampleIssues(result)
    console.log('check:ui-visual 新规则断牙样例（真实 Electron）')
    for (const row of rows) {
      console.log(`  ${row.passed ? '通过' : '失败'}  ${row.rule.padEnd(18)} ${row.expect === 'hit' ? '应命中' : '应放行'}  ${row.id}：${row.note}${row.hit ? `（命中 ${row.issues.length}）` : ''}`)
      if (!row.passed && row.issues.length) console.log(`        ${JSON.stringify(row.issues[0]).slice(0, 240)}`)
    }
    const failed = rows.filter((row) => !row.passed)
    const rules = [...new Set(UI_VISUAL_RULE_SAMPLES.map((sample) => sample.rule))]
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
