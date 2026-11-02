const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createVideoEditScrubScene, createVideoEditScrubAccelerationScene } = require('./uiInspectionSceneVideoEditScrub.cjs')

test('scrub 筛选只命中 4K 连续拖动场景', () => {
  assert.ok(createVideoEditScrubScene().id.includes('scrub'))
  assert.ok(!createVideoEditScrubAccelerationScene().id.includes('scrub'))
})

test('拖动期间发出的慢精确请求即使松手后才回执也不能漏掉', () => {
  const { summarizeScrubAccelerationRound, validateScrubAccelerationCase } = require('./uiInspectionSceneVideoEditScrub.cjs')
  const round = summarizeScrubAccelerationRound({ round: 0, startAt: 0, endAt: 100,
    frames: [{ at: 10, approximate: false }], events: [
      { kind: 'render', id: 1, at: 80 },
      { kind: 'render.completed', id: 1, requestedAt: 80, at: 140, elapsedMs: 60, presented: true },
      { kind: 'render', id: 2, at: 110 },
      { kind: 'render.completed', id: 2, requestedAt: 110, at: 115, elapsedMs: 5, presented: true },
    ] })
  assert.deepEqual(round.events.map(event => event.id), [1, 1])
  assert.equal(round.unanswered, 0)
  assert.throws(() => validateScrubAccelerationCase({ name: 'accelDecel', rounds: [round], exactRenderMs: { p90: 5 }, exactRequestRenderMs: { p90: 5 }, workerMs: { p90: round.events.find(event => event.kind === 'render.completed').elapsedMs } }), /超过 50ms/)
})

test('低延迟的少量精确帧不能掩盖拖动停更或尚未完成的请求', () => {
  const { summarizeScrubAccelerationRound, validateScrubAccelerationCase } = require('./uiInspectionSceneVideoEditScrub.cjs')
  const round = summarizeScrubAccelerationRound({ round: 0, startAt: 0, endAt: 2000, frames: [{ at: 10, approximate: false }], events: [] })
  const result = { name: 'accelDecel', rounds: [round], exactRenderMs: { p90: 5 }, exactRequestRenderMs: { p90: 5 }, workerMs: { p90: 5 } }
  assert.throws(() => validateScrubAccelerationCase(result), /精确画面停更/)
  const unanswered = summarizeScrubAccelerationRound({ round: 0, startAt: 0, endAt: 100, frames: [{ at: 10, approximate: false }], events: [{ kind: 'render', id: 1, at: 80 }] })
  assert.throws(() => validateScrubAccelerationCase({ ...result, rounds: [unanswered] }), /请求没有完成/)
  const lateFirst = summarizeScrubAccelerationRound({ round: 0, startAt: 0, endAt: 900, frames: [{ at: 600, approximate: false }, { at: 800, approximate: false }], events: [] })
  assert.equal(lateFirst.maxExactGapMs, 200)
  assert.doesNotThrow(() => validateScrubAccelerationCase({ ...result, rounds: [lateFirst] }))
})

test('松手前请求在主线程准备、松手后才发送和呈现时仍检查完整耗时', () => {
  const { summarizeScrubAccelerationRound, validateScrubAccelerationCase } = require('./uiInspectionSceneVideoEditScrub.cjs')
  const round = summarizeScrubAccelerationRound({ round: 0, startAt: 0, endAt: 100,
    frames: [{ at: 10, requestedAt: 2, renderMs: 8, approximate: false }, { at: 140, requestedAt: 80, renderMs: 60, approximate: false }],
    events: [{ kind: 'render', id: 1, at: 130 }, { kind: 'render.completed', id: 1, requestedAt: 130, at: 140, elapsedMs: 10, presented: true }],
  })
  assert.equal(round.frames.length, 1)
  assert.equal(round.requestFrames.length, 2)
  assert.throws(() => validateScrubAccelerationCase({ name: 'accelDecel', rounds: [round], exactRenderMs: { p90: 8 }, exactRequestRenderMs: { p90: round.requestFrames[1].renderMs }, workerMs: { p90: 10 } }), /含拖动结束后呈现.*超过 50ms/)
})
