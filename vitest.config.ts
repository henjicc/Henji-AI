import { readFileSync } from 'node:fs'
import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置覆盖 domain 纯函数与按文件声明 jsdom 的 React 组件测试。
 * 默认仍使用 Node 环境，只有带 `@vitest-environment jsdom` 的用例才加载 DOM。
 * alias 对齐 vite.config.ts 的 `@/` -> `src/`，供被测代码间接依赖的模块解析使用。
 */
export default defineConfig({
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
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'packages/*/**/*.test.ts'],
  },
})
