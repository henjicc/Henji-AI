const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { createRuntimeEvidenceCollector, finalizeSceneEvidence } = require('./runtimeEvidence.cjs')

class FakePage extends EventEmitter {
  constructor() {
    super()
    this.queries = []
  }

  async evaluate(_fn, input) {
    this.queries.push(input)
    return {
      events: input.queryLevel === 'error'
        ? [{ timestamp: new Date().toISOString(), level: 'error', source: 'backend', domain: 'cameraStage', event: 'render.failed', message: '着色器失败' }]
        : [],
      hasMore: false,
      corruptedLines: 0,
    }
  }
}

test('按场景边界同时收集浏览器异常和应用接口日志', async () => {
  const page = new FakePage()
  const collector = createRuntimeEvidenceCollector(page)
  collector.begin('3D 线稿')
  page.emit('console', { type: () => 'error', text: () => 'WebGL compile error' })
  const evidence = await collector.finish()
  collector.dispose()

  assert.equal(evidence.passed, false)
  assert.equal(evidence.browserErrors[0].scene, '3D 线稿')
  assert.equal(evidence.logErrors[0].event, 'render.failed')
  assert.equal(page.queries.length, 2)
  assert.equal(page.queries.every((query) => typeof query.queryAfter === 'string'), true)
})

test('ResizeObserver 调度通知不计作应用崩溃', async () => {
  const page = new FakePage()
  page.evaluate = async (_fn, input) => ({
    events: [], hasMore: false, corruptedLines: 0, queryLevel: input.queryLevel,
  })
  const collector = createRuntimeEvidenceCollector(page)
  collector.begin('尺寸变化')
  page.emit('pageerror', new Error('ResizeObserver loop completed with undelivered notifications.'))
  page.emit('console', {
    type: () => 'error',
    text: () => 'ResizeObserver loop limit exceeded',
  })
  const evidence = await collector.finish()
  collector.dispose()

  assert.equal(evidence.passed, true)
  assert.deepEqual(evidence.browserErrors, [])
})

test('场景 setup 失败时 evidence 不得伪报通过', () => {
  const evidence = finalizeSceneEvidence({
    browserErrors: [],
    logErrors: [],
    logWarnings: [],
    logQuery: { truncated: false, corruptedLines: 0 },
    passed: true,
  }, new Error('夹具节点未准备完成'))

  assert.equal(evidence.setupPassed, false)
  assert.equal(evidence.setupError, '夹具节点未准备完成')
  assert.equal(evidence.passed, false)
})
