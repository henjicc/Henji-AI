/**
 * 遮挡与裁切规则（重要记录 020）接入界面巡检：实现只有一份，在 src/core/uiAudit/layoutAudit.ts（运行时布局守卫共用），
 * 这里用 Node 的类型剥离直接加载它，序列化进渲染进程执行，再与 auditUiDom 的结果合并成同一份规则结果。
 */
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { auditUiDom } = require('./uiAuditDom.cjs')

const LAYOUT_RULES = Object.freeze(['controlClipped', 'controlOccluded'])
const SOURCE = path.resolve(__dirname, '..', '..', 'src', 'core', 'uiAudit', 'layoutAudit.ts')
let loading = null

/** 加载正式实现（Node 22.18+ 默认剥离 TS 类型；函数体自包含，可整体序列化）。 */
function loadLayoutAudit() {
  loading ??= import(pathToFileURL(SOURCE).href).then((module) => {
    if (typeof module.auditLayoutIssues !== 'function') throw new Error('layoutAudit.ts 未导出 auditLayoutIssues')
    return module.auditLayoutIssues
  })
  return loading
}

/** 把遮挡裁切结果并入 auditUiDom 的结果；中心页反例的预期命中照 auditUiDom 的口径对账后移除。 */
function mergeLayoutAudit(rules, layout, context = {}) {
  const merged = { ...rules, controlClipped: layout.controlClipped, controlOccluded: layout.controlOccluded }
  const prefix = (sample) => `#${sample.id} / `
  merged.gallerySamples = (rules.gallerySamples ?? []).map((sample) => {
    if (!LAYOUT_RULES.includes(sample.rule)) return sample
    const issues = merged[sample.rule].filter((issue) => issue.element.startsWith(prefix(sample)))
    return { ...sample, issues, passed: sample.expectHit === (issues.length > 0) }
  })
  if (!context.includeGallerySamples) {
    for (const sample of merged.gallerySamples) {
      if (sample.expectHit && LAYOUT_RULES.includes(sample.rule)) merged[sample.rule] = merged[sample.rule].filter((issue) => !issue.element.startsWith(prefix(sample)))
    }
  }
  merged.notes = [...(rules.notes ?? []), `遮挡裁切扫描 ${layout.scanned}`]
  return merged
}

/** 一页的全部 DOM 规则：auditUiDom + 遮挡裁切。 */
async function auditPageRules(page, context = {}) {
  const rules = await page.evaluate(auditUiDom, context)
  const layout = await page.evaluate(await loadLayoutAudit(), {})
  return mergeLayoutAudit(rules, layout, context)
}

module.exports = { LAYOUT_RULES, auditPageRules, loadLayoutAudit, mergeLayoutAudit }
