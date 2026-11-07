import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'path'
import { pathToFileURL } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'
import testSuites from './scripts/lib/testSuites.cjs'
import CostSequencer from './scripts/lib/costSequencer.mjs'
import { videoEditRenderEngineVersion } from './scripts/vite/renderEngineVersion.mjs'

/**
 * 主进程模块在 Windows 按 LOCALAPPDATA 定位程序目录（日志、数据库、缓存），测试一律指到仓库临时目录，
 * 免得没替换日志或存储模块的用例写进用户真实资料。其他平台走 electron 的 app.getPath，测试里由各自的 mock 决定。
 */
const TEST_PROGRAM_ENV = { LOCALAPPDATA: path.resolve(__dirname, '.tmp/test-local-app-data') }

/**
 * 本机跑测试时开发者同时在用这台电脑，CPU 不能被测试吃满：并行上限取一半逻辑核，并把测试进程降到低于正常优先级，
 * 工作线程随主进程优先级。CI 在命令行显式给 --maxWorkers，会覆盖这里的上限。
 */
const LOCAL_MAX_WORKERS = Math.max(1, Math.floor(os.availableParallelism() / 2))
if (!process.env.CI) {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* 无权限调整优先级时照常运行 */ }
}

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
    }, {
      // 作者内置库（HarfBuzz 等 Emscripten 模块）按 import.meta.url 找同目录的 wasm；jsdom 用例里 import.meta.url
      // 是 http://localhost 地址，Node 端读文件会失败，所以换回模块自己的 file 地址。
      name: 'vitest-author-vendor-url',
      transform(code, id) {
        if (!/[\\/]resources[\\/]video-edit-author[\\/]vendor[\\/].+\.mjs$/.test(id) || !code.includes('import.meta.url')) return null
        return { code: code.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(id).href)), map: null }
      },
    }, videoEditRenderEngineVersion({ fixed: 'test' })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      ...(process.env.CI ? {} : { maxWorkers: LOCAL_MAX_WORKERS, minWorkers: 1 }),
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
