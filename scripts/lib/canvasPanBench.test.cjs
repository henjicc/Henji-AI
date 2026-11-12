const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { resolvePanBenchSource } = require('./canvasPanBench.cjs')

const pkg = path.resolve('/bench/TEST.hjpkg')
const exists = (file) => file === pkg

test('平移基准默认隔离：没有源画布包时拒绝启动，而不是退回真实资料', () => {
  assert.throws(() => resolvePanBenchSource({}, exists), /BENCH_SOURCE_PACKAGE/)
  assert.throws(() => resolvePanBenchSource({ BENCH_PROJECT: 'TEST' }, exists), /BENCH_SOURCE_PACKAGE/)
  assert.throws(() => resolvePanBenchSource({ BENCH_SOURCE_PACKAGE: 'TEST.hjpkg' }, exists), /绝对路径/)
  assert.throws(() => resolvePanBenchSource({ BENCH_SOURCE_PACKAGE: path.resolve('/missing.hjpkg') }, exists), /不存在/)
  assert.deepEqual(resolvePanBenchSource({ BENCH_SOURCE_PACKAGE: pkg }, exists), { realUserData: false, projectName: null, packagePath: pkg })
})

test('只有 BENCH_REAL_DATA=1 才用真实资料并按名称找源画布', () => {
  assert.deepEqual(resolvePanBenchSource({ BENCH_REAL_DATA: '1' }, exists), { realUserData: true, projectName: 'TEST', packagePath: null })
  assert.equal(resolvePanBenchSource({ BENCH_REAL_DATA: '1', BENCH_PROJECT: 'A' }, exists).projectName, 'A')
  assert.throws(() => resolvePanBenchSource({ BENCH_REAL_DATA: 'true' }, exists), /BENCH_SOURCE_PACKAGE/)
})
