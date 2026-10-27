const assert = require('node:assert/strict')
const test = require('node:test')
const { checkRendererOutputNames } = require('./check-renderer-output-names.cjs')

const main = { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' }
const worker = { entryFileNames: 'assets/[name]-[hash].worker.js', chunkFileNames: 'assets/[name]-[hash].worker.js', assetFileNames: 'assets/[name]-[hash].worker[extname]' }
const renderer = (mainOutput, workerOutput) => ({ build: { rollupOptions: { output: mainOutput } }, worker: { rollupOptions: { output: workerOutput } } })

test('主包与 Worker 按约定命名时通过', () => {
  assert.deepEqual(checkRendererOutputNames(renderer(main, worker)), [])
})

test('Worker 沿用主包同一命名规则（2026-10-27 构建失败的配置）时报错', () => {
  const problems = checkRendererOutputNames(renderer(main, main))
  assert.equal(problems.length, 3)
  assert.match(problems[0], /Worker entryFileNames/)
})

test('只给 Worker 加目录或前缀不算证明不相交', () => {
  const prefixed = { ...worker, chunkFileNames: 'assets/worker-[name]-[hash].js' }
  assert.match(checkRendererOutputNames(renderer(main, prefixed)).join('\n'), /Worker chunkFileNames/)
})

test('缺少显式命名或写成函数时无法静态证明，报错', () => {
  assert.match(checkRendererOutputNames(renderer(undefined, worker)).join('\n'), /renderer\.build\.rollupOptions\.output 必须/)
  assert.match(checkRendererOutputNames(renderer(main, { ...worker, assetFileNames: () => 'x' })).join('\n'), /assetFileNames 必须是字符串/)
  assert.match(checkRendererOutputNames(renderer(main, [worker])).join('\n'), /单个 output 对象/)
})

test('主包在哈希后另加后缀时报错', () => {
  assert.match(checkRendererOutputNames(renderer({ ...main, chunkFileNames: 'assets/[name]-[hash].worker.js' }, worker)).join('\n'), /主包 chunkFileNames/)
})
