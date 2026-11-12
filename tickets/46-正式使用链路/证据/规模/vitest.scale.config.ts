import path from 'node:path'
import { defineConfig } from 'vitest/config'

// 规模基准专用配置：只跑本目录的基准文件，不进任何正式测试套件。
const root = path.resolve(__dirname, '../../../..')
export default defineConfig({
  root,
  cacheDir: path.resolve(root, '.tmp/vite-test-cache'),
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    include: ['tickets/46-正式使用链路/证据/规模/*.bench.test.ts'],
    pool: 'forks', minWorkers: 1, maxWorkers: 1, fileParallelism: false,
    testTimeout: 60_000,
    env: { HENJI_DATA_ROOT: path.resolve(root, '.tmp/test-data-root') },
  },
})
