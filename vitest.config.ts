import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * 最小 vitest 配置：只跑 domain 纯函数单元测试（渲染层 src + 主进程 electron）。
 * 不接 UI/组件测试环境（无需 jsdom），保持配置通用，供后续任务（1.3/1.4 等）复用。
 * alias 对齐 vite.config.ts 的 `@/` -> `src/`，供被测代码间接依赖的模块解析使用。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
})
