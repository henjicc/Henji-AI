import { readFileSync } from 'node:fs'
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'
import testSuites from './scripts/lib/testSuites.cjs'
import CostSequencer from './scripts/lib/costSequencer.mjs'

/**
 * 主进程模块在 Windows 按 LOCALAPPDATA 定位程序目录（日志、数据库、缓存），测试一律指到仓库临时目录，
 * 免得没替换日志或存储模块的用例写进用户真实资料。其他平台走 electron 的 app.getPath，测试里由各自的 mock 决定。
 */
const TEST_PROGRAM_ENV = { LOCALAPPDATA: path.resolve(__dirname, '.tmp/test-local-app-data') }

/**
 * Vitest 配置覆盖 domain 纯函数与按文件声明 jsdom 的 React 组件测试。
 * 默认仍使用 Node 环境，只有带 `@vitest-environment jsdom` 的用例才加载 DOM。
 * alias 对齐 vite.config.ts 的 `@/` -> `src/`，供被测代码间接依赖的模块解析使用。
 */
export default defineConfig(({ mode }) => {
  const suite = testSuites.testSuiteOptions(mode, configDefaults.exclude)
  return {
    cacheDir: path.resolve(__dirname, '.tmp/vite-test-cache'),
    plugins: [{
      name: 'vitest-wgsl-raw',
      enforce: 'pre',
      load(id) {
        const queryIndex = id.indexOf('?')
        const filename = queryIndex < 0 ? id : id.slice(0, queryIndex)
        if (!filename.endsWith('.wgsl')) return null
        return `export default ${JSON.stringify(readFileSync(filename, 'utf8'))}`
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      ...suite,
      env: { ...TEST_PROGRAM_ENV, ...suite.env },
      ...(mode === 'unit' && process.env.HENJI_TEST_COSTS ? {
        sequence: { sequencer: CostSequencer },
      } : {}),
      ...(mode === 'unit' && process.env.HENJI_TEST_COST_REPORT ? {
        reporters: ['default', './scripts/lib/costReporter.cjs'],
      } : {}),
    },
  }
})
