const assert = require('node:assert/strict')
const test = require('node:test')
const { analyzeLayoutMetrics, countVisualRows, isTruncated } = require('./uiReviewMetrics.cjs')

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })

function rawWith({ items = [], texts = [], container = rect(0, 0, 600, 40), scroll = { scrollWidth: 600, clientWidth: 600 }, overflowX = 'visible' } = {}) {
  return {
    container,
    containerScroll: { ...scroll, scrollHeight: container.height, clientHeight: container.height },
    containerOverflowX: overflowX,
    viewport: { width: 960, height: 640 },
    items: items.map((value, index) => ({ label: `item${index}`, rect: value })),
    texts,
  }
}

const text = (overrides) => ({
  text: '文生视频', length: 4, clientWidth: 60, scrollWidth: 60, clientHeight: 20, scrollHeight: 20,
  overflowX: 'visible', overflowY: 'visible', textOverflow: 'clip', lineClamp: 'none', whiteSpace: 'nowrap',
  lineCount: 1, hasFullTextHint: false, label: 'span', ...overrides,
})

test('行数：高低不同但竖直重叠的控件算一行，完全错开才算折行', () => {
  assert.equal(countVisualRows([rect(0, 4, 32, 32), rect(40, 6, 80, 28), rect(130, 0, 36, 36)]), 1)
  assert.equal(countVisualRows([rect(0, 0, 32, 32), rect(0, 40, 32, 32)]), 2)
  // 只蹭到 1px 的上下相邻行不算同一行
  assert.equal(countVisualRows([rect(0, 0, 32, 32), rect(0, 31, 32, 32)]), 2)
  assert.equal(countVisualRows([rect(0, 0, 0, 32)]), 0)
})

test('截断：overflow 裁切或 ellipsis 且内容更宽；line-clamp 且内容更高', () => {
  assert.equal(isTruncated(text({ overflowX: 'hidden', scrollWidth: 90 })), 'horizontal')
  assert.equal(isTruncated(text({ textOverflow: 'ellipsis', scrollWidth: 61 })), null)
  assert.equal(isTruncated(text({ textOverflow: 'ellipsis', scrollWidth: 62 })), 'horizontal')
  assert.equal(isTruncated(text({ lineClamp: '2', scrollHeight: 44 })), 'vertical')
  assert.equal(isTruncated(text({ scrollWidth: 90 })), null)
})

test('指标：单行底栏无可疑；折行、溢出、截断与短标签折行分别给出原因', () => {
  const clean = analyzeLayoutMetrics(rawWith({ items: [rect(0, 4, 32, 32), rect(40, 4, 120, 32)], texts: [text()] }))
  assert.equal(clean.rows, 1)
  assert.equal(clean.suspicious, false)

  const wrapped = analyzeLayoutMetrics(rawWith({ items: [rect(0, 0, 32, 32), rect(0, 40, 32, 32)] }))
  assert.equal(wrapped.rows, 2)
  assert.match(wrapped.reasons.join(), /折行：2 行（上限 1）/)
  assert.equal(analyzeLayoutMetrics(rawWith({ items: [rect(0, 0, 32, 32), rect(0, 40, 32, 32)] }), { maxRows: null }).suspicious, false)

  const overflow = analyzeLayoutMetrics(rawWith({ items: [rect(560, 4, 80, 32)], scroll: { scrollWidth: 640, clientWidth: 600 }, overflowX: 'hidden' }))
  // overflow: visible 的容器里凸出的端口不算容器溢出
  assert.equal(analyzeLayoutMetrics(rawWith({ scroll: { scrollWidth: 611, clientWidth: 600 } })).containerOverflow, false)
  assert.deepEqual(overflow.overflowingItems, ['item0'])
  assert.equal(overflow.containerOverflow, true)

  const offscreen = analyzeLayoutMetrics(rawWith({ container: rect(900, 0, 200, 40), items: [rect(920, 4, 120, 32)] }))
  assert.deepEqual(offscreen.offscreenItems, ['item0'])

  const truncated = analyzeLayoutMetrics(rawWith({ texts: [
    text({ text: '精确模型：高保真', overflowX: 'hidden', scrollWidth: 120 }),
    text({ text: '分辨率', textOverflow: 'ellipsis', scrollWidth: 80, hasFullTextHint: true }),
  ] }))
  assert.equal(truncated.truncated.length, 2)
  assert.match(truncated.reasons.join('；'), /截断且悬停看不全：精确模型：高保真/)
  assert.match(truncated.reasons.join('；'), /截断（有悬停提示）：1 处/)

  const wrappedLabel = analyzeLayoutMetrics(rawWith({ texts: [text({ text: '时长', length: 2, lineCount: 2, whiteSpace: 'normal' })] }))
  assert.deepEqual(wrappedLabel.wrappedLabels, [{ text: '时长', lines: 2, element: 'span' }])
  // 长段落多行不是“短标签折行”
  assert.equal(analyzeLayoutMetrics(rawWith({ texts: [text({ length: 40, lineCount: 3 })] })).wrappedLabels.length, 0)
})
