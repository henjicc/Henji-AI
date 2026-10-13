const { test } = require('node:test')
const assert = require('node:assert/strict')
const { auditUiDom } = require('./uiAuditDom.cjs')
const { UI_VISUAL_RULE_SAMPLES, reconcileSampleIssues } = require('./uiVisualRuleSamples.cjs')

async function audit(html, context = {}) {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const nativeStyle = w.getComputedStyle.bind(w)
  w.getComputedStyle = element => nativeStyle(element)
  w.document.elementsFromPoint = () => [...w.document.querySelectorAll('*')]
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const [x, y, width, height] = (this.dataset.rect || '0,0,200,32').split(',').map(Number)
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height }
  }
  for (const e of w.document.querySelectorAll('[data-scroll]')) {
    const [clientHeight, scrollHeight] = e.dataset.scroll.split(',').map(Number)
    Object.defineProperties(e, { clientHeight: { value: clientHeight }, scrollHeight: { value: scrollHeight } })
  }
  try { return w.eval(`(${auditUiDom.toString()})(${JSON.stringify(context)})`) } finally { w.close() }
}

test('5.2 DOM 断牙夹具同时具备反例命中和正例放行', async () => {
  for (const sample of UI_VISUAL_RULE_SAMPLES.filter(sample => sample.id.startsWith('contract-'))) {
    const result = await audit(sample.html)
    assert.equal(reconcileSampleIssues(result, [sample])[0].passed, true, sample.id)
  }
})

test('同行检查真实外框（含分段壳、读数），排除内部按钮、xl与竖向工具条', async () => {
  const run = (h, y = 0) => audit(`<div role="toolbar"><button data-rect="0,0,32,32"></button><div><button data-rect="40,${y},32,${h}"></button></div></div>`)
  assert.equal((await run(28)).rowHeightMismatch.length, 1)
  assert.equal((await run(32, 2)).rowHeightMismatch.length, 1)
  assert.equal((await run(32)).rowHeightMismatch.length, 0)
  assert.equal((await audit('<div role="toolbar"><button data-rect="0,0,32,32"></button><div data-ui-segmented data-rect="40,0,80,36"><button data-rect="42,2,32,32"></button></div></div>')).rowHeightMismatch.length, 1)
  assert.equal((await audit('<div role="toolbar" aria-orientation="vertical"><button data-rect="0,0,32,32"></button><button data-size="xl" data-rect="0,40,40,40"></button></div>')).rowHeightMismatch.length, 0)
})

test('样张预期命中只扣除对应规则，断牙失败和正例回归仍能查出', async () => {
  const fixture = (attributes, buttons = '<button data-variant="primary"></button><button data-variant="primary"></button>') => `<section id="sample" data-gallery-rule-sample="multiplePrimary" ${attributes}><div data-ui-toolbar>${buttons}</div></section>`
  const bad = await audit(fixture('data-gallery-expect-hit="multiplePrimary"'))
  assert.equal(bad.gallerySamples[0].passed, true)
  assert.equal(bad.multiplePrimary.length, 0)
  assert.equal((await audit(fixture('data-gallery-expect-hit="multiplePrimary"'), { includeGallerySamples: true })).multiplePrimary.length, 1)
  assert.equal((await audit(fixture('data-gallery-expect-hit="multiplePrimary"', '<button data-variant="primary"></button>'))).gallerySamples[0].passed, false)
  const goodRegressed = await audit(fixture('data-gallery-expect-clean="multiplePrimary"'))
  assert.equal(goodRegressed.gallerySamples[0].passed, false)
  assert.equal(goodRegressed.multiplePrimary.length, 1)
  const partial = await audit(fixture('data-gallery-expect-hit="multiplePrimary" data-rect="0,-8,200,32"'))
  assert.equal(partial.gallerySamples.length, 0)
  assert.equal(partial.multiplePrimary.length, 0, '半露出的已登记反例仍不混入生产问题')
})

test('条带样张以样本作为工作面边界，外面的目录滚动不隐藏反例', async () => {
  const bands = Array.from({length: 3}, (_, i) => `<div data-command-bar data-rect="0,${i * 32},400,32"><button data-rect="0,${i * 32},32,32"></button></div>`).join('')
  const result = await audit(`<div style="overflow-y:auto"><section id="bands" data-gallery-rule-sample="stackedBands" data-gallery-expect-hit="stackedBands" data-rect="0,0,400,96"><div data-rect="0,0,400,96">${bands}</div></section></div>`)
  assert.equal(result.gallerySamples[0].passed, true)
})

test('主动作只统计可见且最近表面拥有的按钮', async () => {
  assert.equal((await audit('<div role="dialog"><button data-variant="primary"></button><button data-tone="accent"></button></div>')).multiplePrimary.length, 1)
  assert.equal((await audit('<div role="dialog"><button data-variant="primary"></button><div role="dialog"><button data-variant="primary"></button></div><button style="display:none" data-variant="primary"></button></div>')).multiplePrimary.length, 0)
})

test('面板列对齐、动作不得从标签列起头，独立嵌套组不混算', async () => {
  const html = '<div data-ui-group><div data-ui-form-row="panel"><div data-ui-form-control data-rect="96,0,100,32"><button data-rect="96,0,32,32"></button></div></div>'
  assert.equal((await audit(`${html}<button data-rect="0,40,32,32"></button></div>`)).actionStartsAtLabelColumn.length, 1)
  assert.equal((await audit(`${html}<button data-rect="96,40,32,32"></button></div>`)).actionStartsAtLabelColumn.length, 0)
  assert.equal((await audit(`${html}<div data-ui-form-row="panel"><div data-ui-form-control data-rect="120,40,100,32"></div></div></div>`)).formControlMisaligned.length, 1)
  assert.equal((await audit(`${html}<div data-ui-group><div data-ui-form-row="panel"><div data-ui-form-control data-rect="120,40,100,32"></div></div></div></div>`)).formControlMisaligned.length, 0)
})

test('2xs 仅正式图标按钮 20px 例外，缩小与伪造标记仍失败；滚动尺寸不因子项不可见消失', async () => {
  assert.equal((await audit('<button class="ui-btn" data-tone="default" data-size="2xs" data-rect="0,0,20,20"></button>')).smallTargets.length, 0)
  assert.equal((await audit('<button data-size="2xs" data-rect="0,0,20,20"></button>')).smallTargets.length, 1)
  assert.equal((await audit('<button class="ui-btn" data-tone="default" data-size="2xs" data-rect="0,0,18,18"></button>')).smallTargets.length, 1)
  assert.equal((await audit('<div id="scroll" style="overflow-y:auto" data-scroll="200,800" data-rect="0,0,200,200"></div>')).scrollRegions[0].scrollHeight, 800)
})
