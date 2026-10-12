const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { balanceFiles, readCosts, writeCosts } = require('./testCosts.cjs')

test('历史成本分片均衡且模式隔离，本地精确运行沿用默认行为', async (t) => {
  const files = ['a', 'b', 'c', 'd', 'e', 'new']
  const costs = { a: 90, b: 70, c: 30, d: 20, e: 10 }
  const result = balanceFiles(files, costs, 3)
  assert.deepEqual(result, balanceFiles([...files].reverse(), costs, 3))
  assert.deepEqual(result.flatMap((shard) => shard.files).sort(), [...files].sort())
  assert.equal(new Set(result.flatMap((shard) => shard.files)).size, files.length)
  assert.ok(Math.max(...result.map((shard) => shard.cost)) - Math.min(...result.map((shard) => shard.cost)) <= 30)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-test-costs-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const oldHistory = process.env.HENJI_TEST_COSTS, oldReport = process.env.HENJI_TEST_COST_REPORT
  t.after(() => {
    for (const [key, value] of [['HENJI_TEST_COSTS', oldHistory], ['HENJI_TEST_COST_REPORT', oldReport]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  delete process.env.HENJI_TEST_COSTS
  delete process.env.HENJI_TEST_COST_REPORT
  const root = path.resolve(__dirname, '../..')
  const { loadConfigFromFile } = await import('vite')
  const load = async mode => (await loadConfigFromFile({ command: 'serve', mode }, path.join(root, 'vitest.config.ts'), root, 'silent')).config.test
  for (const mode of ['test', 'unit']) {
    const config = await load(mode)
    assert.equal(config.sequence, undefined)
    assert.equal(config.reporters, undefined)
  }
  process.env.HENJI_TEST_COSTS = path.join(directory, 'history.json')
  process.env.HENJI_TEST_COST_REPORT = path.join(directory, 'report.json')
  writeCosts(process.env.HENJI_TEST_COSTS, costs)
  const config = await load('unit')
  assert.equal(typeof config.sequence.sequencer, 'function')
  assert.deepEqual(config.reporters, ['default', './scripts/lib/costReporter.cjs'])
  const specs = files.map(file => [null, path.join(root, file)])
  for (let index = 1; index <= 3; index++) {
    const sequencer = new config.sequence.sequencer({ config: { root, shard: { index, count: 3 } } })
    assert.deepEqual((await sequencer.shard(specs)).map(([, file]) => path.relative(root, file)).sort(), result[index - 1].files.slice().sort())
  }
  for (const mode of ['test', 'gpu', 'native', 'image-export', 'ffmpeg-cli', 'performance']) {
    const isolated = await load(mode)
    assert.equal(isolated.sequence, undefined, mode)
    assert.equal(isolated.reporters, undefined, mode)
  }
  const Reporter = require('./costReporter.cjs')
  const reporter = new Reporter()
  reporter.onInit({ config: { root } })
  reporter.onFinished([{ filepath: path.join(root, 'a'), result: { state: 'pass', duration: 10 }, collectDuration: 20, prepareDuration: 30, environmentLoad: 40 }])
  assert.deepEqual(readCosts(process.env.HENJI_TEST_COST_REPORT), { a: 100 })
})
