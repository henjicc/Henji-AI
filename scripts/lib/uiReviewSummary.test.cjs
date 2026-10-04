const assert = require('node:assert/strict')
const test = require('node:test')
const { renderVariantSummary, summarizeVariantMetrics } = require('./uiReviewSummary.cjs')

const metrics = (overrides = {}) => ({
  rows: 1, itemCount: 4, triggerCount: 0, slack: 0, containerOverflow: false, overflowingItems: [], offscreenItems: [],
  truncated: [], wrappedLabels: [], texts: [], suspicious: false, reasons: [], ...overrides,
})
const entry = (variant, size, name, value) => ({
  size, variant, suffix: `${variant}-${name}`, file: `${size}-scene-${variant}-${name}.png`, metrics: value,
})

test('变体汇总：按变体 × 尺寸归组，识别折行、截断与“有空间仍收起”', () => {
  const rows = summarizeVariantMetrics([
    entry('kie-fast', '1440x900', 'bar', metrics({ texts: ['Seedance 2.0 Fast', '模式'] })),
    entry('kie-fast', '1440x900', 'row', metrics({ slack: 360, width: 700, childWidths: [120, 100, 120] })),
    entry('kie-fast', '1440x900', 'more', metrics({ triggerCount: 1, texts: ['分辨率', '智能 / 720p'] })),
    entry('kie-fast', '960x640', 'bar', metrics({ rows: 2 })),
    entry('kie-fast', '960x640', 'row', metrics({ slack: 20, width: 500, childWidths: [200, 180, 100] })),
    entry('kie-fast', '960x640', 'more', metrics({ triggerCount: 2 })),
    entry('kie-fast', '960x640', 'first-menu', metrics({ truncated: [{ text: '精确模型：高保真', hint: false }] })),
    entry('fal-ok', '1440x900', 'bar', metrics()),
    entry('fal-ok', '1440x900', 'row', metrics({ slack: 400, width: 600, childWidths: [100, 100] })),
  ], { captured: new Set(['1440x900-scene-kie-fast-bar.png', '1440x900-scene-kie-fast-more.png']) })
  assert.equal(rows.length, 3)
  const [fast1440, fast960, ok] = rows
  assert.deepEqual(fast1440.collapsedTexts, ['分辨率', '智能 / 720p'])
  assert.match(fast1440.flags.join(), /接近放得下仍收起：收纳行扣间距后空余约 324px/)
  assert.deepEqual(Object.keys(fast1440.files), ['bar', 'more'])
  assert.deepEqual(Object.keys(fast960.files), [])
  assert.match(fast960.flags.join('；'), /底栏折行 2 行/)
  assert.match(fast960.flags.join('；'), /截断且悬停看不全：精确模型：高保真/)
  assert.doesNotMatch(fast960.flags.join('；'), /接近放得下仍收起/)
  // 空余扣间距后不足一个触发器（Seedance 2.0 Fast 实测：170 - 3×12 = 134 ≥ 100 会报，110 - 36 不报）
  const tight = summarizeVariantMetrics([
    entry('x', '1440x900', 'row', metrics({ slack: 110, width: 579, childWidths: [172, 135, 102] })),
    entry('x', '1440x900', 'more', metrics({ triggerCount: 1 })),
  ])
  assert.equal(tight[0].suspicious, false)
  // 没有“更多参数”时空余再大也不可疑
  assert.equal(ok.suspicious, false)
  assert.match(renderVariantSummary(rows), /变体 × 尺寸 3 行，可疑 2 行/)
})
