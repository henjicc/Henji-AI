const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadLayoutAudit, mergeLayoutAudit } = require('./uiLayoutAudit.cjs')

/** 与巡检同口径：正式实现经类型剥离后整体序列化，在页面上下文里执行（不能依赖模块作用域）。 */
async function audit(html) {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const [left, top, right, bottom] = (this.dataset.rect || '0 0 1440 900').split(' ').map(Number)
    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top }
  }
  w.document.elementFromPoint = () => w.document.body
  const fn = await loadLayoutAudit()
  try { return w.eval(`(${fn.toString()})({})`) } finally { w.close() }
}

test('遮挡裁切的正式实现可整体序列化执行，并与 auditUiDom 结果合并、对账中心页反例', async () => {
  const layout = await audit('<section id="sample-a" data-gallery-rule-sample="controlClipped"><div style="overflow-x:hidden;overflow-y:hidden" data-rect="0 0 100 40"><button aria-label="被裁" data-rect="80 10 140 30"></button></div></section>')
  assert.equal(layout.controlClipped.length, 1)
  assert.match(layout.controlClipped[0].element, /^#sample-a \/ button/)
  const rules = { notes: ['扫描可见元素 3'], gallerySamples: [{ id: 'sample-a', rule: 'controlClipped', expectHit: true, passed: false, issues: [] }] }
  const merged = mergeLayoutAudit(rules, layout)
  assert.equal(merged.gallerySamples[0].passed, true)
  assert.equal(merged.controlClipped.length, 0, '反例的预期命中在普通审计里移除')
  assert.equal(mergeLayoutAudit(rules, layout, { includeGallerySamples: true }).controlClipped.length, 1)
})
