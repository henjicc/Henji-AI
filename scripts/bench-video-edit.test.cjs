const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { baselineVerdict, findProjectRoot, parseArgs } = require('./bench-video-edit.cjs')

const run = (droppedRatio, p50, p95, max = 99) => ({ expectedFrames: 600, droppedRatio, renderMs: { p50, p95, max } })

test('两遍跳帧比例与渲染耗时 P50/P95 都在 5% 内才算基线，最大值不参与判定', () => {
  assert.equal(baselineVerdict([run(0.05, 10, 20, 30), run(0.0515, 10.4, 20.9, 300)]).stable, true)
  const verdict = baselineVerdict([run(0.05, 10, 20), run(0.05, 10, 21.5)])
  assert.equal(verdict.stable, false)
  assert.deepEqual(verdict.checks.filter(check => !check.ok).map(check => check.metric), ['renderMs.p95'])
})

test('几乎不跳帧时跳帧比例允许相差一帧', () => {
  assert.equal(baselineVerdict([run(0, 8, 12), run(1 / 600, 8, 12)]).stable, true)
  assert.equal(baselineVerdict([run(0, 8, 12), run(2 / 600, 8, 12)]).stable, false)
})

test('缺少渲染样本不能算基线', () => {
  assert.equal(baselineVerdict([run(0, null, null), run(0, null, null)]).stable, false)
})

test('参数解析：默认值、取值校验与真实工程路径', () => {
  const defaults = parseArgs([])
  assert.equal(defaults.rounds, 2); assert.equal(defaults.warmup, 1); assert.equal(defaults.tolerance, 0.05); assert.equal(defaults.diagnostics, false); assert.equal(defaults.project, null)
  const custom = parseArgs(['--project', 'some/project', '--from', '60', '--to', '600', '--rounds', '3', '--diagnostics'])
  assert.equal(custom.project, path.resolve('some/project')); assert.equal(custom.from, 60); assert.equal(custom.to, 600); assert.equal(custom.rounds, 3); assert.equal(custom.diagnostics, true)
  assert.throws(() => parseArgs(['--rounds', '1']), /--rounds/)
  assert.throws(() => parseArgs(['--from', '10', '--to', '5']), /--to/)
  assert.throws(() => parseArgs(['--project']), /需要一个值/)
  assert.throws(() => parseArgs(['--bogus']), /未知选项/)
  assert.equal(parseArgs(['-h']).help, true)
})

test('传入工程里的文件时按 .henji/project.json 找工程根，不在工程里就报错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-bench-root-'))
  try {
    const project = path.join(root, '项目', '元宝')
    fs.mkdirSync(path.join(project, '.henji'), { recursive: true }); fs.writeFileSync(path.join(project, '.henji', 'project.json'), '{}')
    fs.mkdirSync(path.join(project, '剪辑'), { recursive: true }); fs.writeFileSync(path.join(project, '剪辑', '主剪辑.henji-video'), '{}')
    assert.equal(findProjectRoot(path.join(project, '剪辑', '主剪辑.henji-video')), project)
    assert.equal(findProjectRoot(project), project)
    assert.throws(() => findProjectRoot(path.join(root, '项目')), /不在痕迹AI工程里/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
