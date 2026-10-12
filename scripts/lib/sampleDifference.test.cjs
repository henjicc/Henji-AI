const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const test = require('node:test')
test('集中样本比较保留 Object.is、close 严格阈值、NaN 和长度语义', () => {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'sampleDifference.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports })
  const { sampleDifference } = exports
  assert.equal(sampleDifference([NaN, -0], [NaN, 0]).differences, 1)
  assert.equal(sampleDifference([NaN], [NaN], 6).differences, 1)
  assert.equal(sampleDifference([0], [0.0000005], 6).differences, 1)
  assert.equal(sampleDifference([0], [0.00000049], 6).differences, 0)
  assert.equal(sampleDifference([1], [1, 2]).lengthDifference, -1)
})
