const assert = require('node:assert/strict')
const test = require('node:test')
const { closeLargeCpuFallbackDocument, LARGE_CPU_CLOSE_TIMEOUT_MS } = require('./uiInspectionSceneCatalogGpuRaster.cjs')

function install(t, { closeAfter = 35000, failure = null, projection = {}, loaded = {}, metadata = {}, hasMore = false,
  legacyLocatorReportsVisible = false } = {}) {
  let now = 0; let clicks = 0; let loads = 0; let legacyLocatorReads = 0
  const queries = []; const logs = []
  t.mock.method(Date, 'now', () => now)
  t.mock.method(console, 'log', (value) => logs.push(value))
  const original = { documentRef: 'doc-ref', revision: 4, previewRef: null,
    document: { id: 'doc-id', revision: 4, geometry: { width: 8192, height: 8192 }, layers: [{ id: 'original' }] } }
  const previous = global.window
  const previousDocument = global.document
  global.window = { henjiNative: {
    imageEditorV3: {
      loadDocument: async ({ documentRef }) => {
        assert.equal(documentRef, 'doc-ref')
        loads += 1
        return loads === 1 ? original : { ...original, previewRef: 'new-preview', ...loaded }
      },
      describeSourcePyramid: async ({ resourceRef }) => {
        assert.equal(resourceRef, 'new-preview')
        return { levels: [{ mip: 0, width: 8192, height: 8192 }], ...metadata }
      },
    },
    db: { select: async (sql, values) => {
      assert.match(sql, /SELECT nodes_json/)
      assert.deepEqual(values, ['project'])
      return [{ nodes_json: JSON.stringify([{ id: 'node', data: { imageEditSession: {
        documentRef: 'doc-ref', revision: 4, previewRef: 'new-preview', ...projection,
      } } }]) }]
    } },
    logging: { queryLogEvents: async (query) => {
      queries.push(query)
      return { hasMore, events: [{ event: query.keyword, timestamp: '1970-01-01T00:00:01Z',
        context: { documentId: 'doc-id', revision: 4 } },
      { event: query.keyword, timestamp: '1970-01-01T00:00:01Z', context: { documentId: 'unrelated', revision: 4 } }] }
    } },
  } }
  global.document = {
    querySelector: (selector) => {
      assert.equal(selector, '[data-image-editor-v3]')
      if (now >= closeAfter) return null
      return { closest: (dialogSelector) => {
        assert.equal(dialogSelector, '[role="dialog"]')
        return { textContent: failure ?? '正在保存' }
      } }
    },
  }
  t.after(() => {
    if (previous === undefined) delete global.window; else global.window = previous
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument
  })
  const page = { evaluate: (callback, value) => callback(value), waitForTimeout: async (delay) => { now += delay } }
  const dialog = { getByRole: () => ({ click: async () => { clicks += 1 } }),
    isVisible: async () => { legacyLocatorReads += 1; return legacyLocatorReportsVisible || now < closeAfter },
    textContent: async () => { legacyLocatorReads += 1; throw new Error('已卸载 dialog 不应被 locator 重新等待') } }
  const editor = { locator: () => ({ getAttribute: async () => '4' }) }
  return { run: () => closeLargeCpuFallbackDocument(page, dialog, editor,
    { documentRef: 'doc-ref', nodeId: 'node' }, 'project'), queries, logs,
  get clicks() { return clicks }, get loads() { return loads }, get now() { return now },
  get legacyLocatorReads() { return legacyLocatorReads } }
}

test('8192专属关闭允许超过30秒，单次点击并验证真实预览与同revision节点落盘；重复日志不算新进展', async (t) => {
  const harness = install(t)
  const result = await harness.run()
  assert.ok(result.elapsedMs >= 35000 && result.elapsedMs < LARGE_CPU_CLOSE_TIMEOUT_MS)
  assert.equal(harness.clicks, 1)
  assert.equal(harness.loads, 2)
  assert.equal(harness.queries.length, 9)
  assert.ok(harness.queries.every((query) => query.limit === 20 && query.level === 'info' && query.keyword))
  const progress = harness.logs.map((value) => JSON.parse(value.slice(value.indexOf('{'))))
  assert.equal(progress[0].newEvents.length, 3)
  assert.deepEqual(progress[1].newEvents, [])
  assert.equal(progress.at(-1).state, 'closed-and-persisted')
})

test('保存失败立即结束，不再点击，不回读伪造成功', async (t) => {
  const harness = install(t, { failure: '保存失败，重试关闭' })
  await assert.rejects(harness.run(), /保存失败.*保留现场/)
  assert.equal(harness.now, 0)
  assert.equal(harness.clicks, 1)
  assert.equal(harness.loads, 1)
})

test('关闭后dialog刚判定可见即卸载时，不等待不存在的locator重新出现', async (t) => {
  const harness = install(t, { closeAfter: 0, legacyLocatorReportsVisible: true })
  const result = await harness.run()
  assert.equal(result.revision, 4)
  assert.equal(harness.legacyLocatorReads, 0)
  assert.equal(harness.clicks, 1)
  assert.equal(harness.loads, 2)
})

test('无进展仍仅180秒预算，不无限等待或反复关闭', async (t) => {
  const harness = install(t, { closeAfter: Infinity })
  await assert.rejects(harness.run(), /超出180秒/)
  assert.equal(harness.now, LARGE_CPU_CLOSE_TIMEOUT_MS)
  assert.equal(harness.clicks, 1)
  assert.equal(harness.loads, 1)
  assert.ok(harness.logs.length < 18)
})

test('关闭消失不等于落盘：旧节点预览、错误revision、缺预览和错误尺寸均拒绝', async (t) => {
  for (const options of [{ projection: { previewRef: 'old' } }, { projection: { revision: 3 } },
    { loaded: { revision: 5 } }, { loaded: { previewRef: null } },
    { metadata: { levels: [{ mip: 0, width: 1024, height: 1024 }] } }]) {
    await t.test(JSON.stringify(options), async (sub) => {
      const harness = install(sub, { closeAfter: 0, ...options })
      await assert.rejects(harness.run(), /真实预览或节点投影不一致/)
      assert.equal(harness.clicks, 1)
    })
  }
})

test('截断进展证据必须失败，不把缺失日志当成完整保存过程', async (t) => {
  const harness = install(t, { hasMore: true })
  await assert.rejects(harness.run(), /进展事件被截断/)
  assert.equal(harness.clicks, 1)
})
