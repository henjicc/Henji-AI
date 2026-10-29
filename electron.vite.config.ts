import { relative, resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { videoEditRenderEngineVersion } from './scripts/vite/renderEngineVersion.mjs'
import { replayMainWorld } from './scripts/vite/replayMainWorld'

/**
 * 热更新只原地替换界面组件（以及自己声明接受热更新的模块）；改到业务服务、工具函数这类模块时整页重新加载。
 * Vite 默认沿依赖链重新执行这些模块，新旧两份服务各自持有状态（打开的工程、撤销栈、助手能力注册），
 * 界面改的和助手改的就不是同一份文档（2026-10-26 实测改通用工具后剪辑回到工程列表，助手仍连着旧的那份）。
 */
function reloadOnStatefulModuleUpdate(): Plugin {
  return {
    name: 'henji:reload-on-stateful-module-update',
    apply: 'serve',
    handleHotUpdate({ modules, server }) {
      if (modules.every(module => module.type === 'css' || module.isSelfAccepting)) return
      server.ws.send({ type: 'full-reload' })
      return []
    },
  }
}

/** 渲染层主包产物：哈希后紧跟唯一扩展名（与 Vite 默认一致，显式写出供门禁比对）。 */
export const RENDERER_OUTPUT_NAMES = {
  entryFileNames: 'assets/[name]-[hash].js',
  chunkFileNames: 'assets/[name]-[hash].js',
  assetFileNames: 'assets/[name]-[hash][extname]',
} as const
/** Worker 子构建产物：哈希后带 .worker，与主包命名结构上不相交。 */
export const RENDERER_WORKER_OUTPUT_NAMES = {
  entryFileNames: 'assets/[name]-[hash].worker.js',
  chunkFileNames: 'assets/[name]-[hash].worker.js',
  assetFileNames: 'assets/[name]-[hash].worker[extname]',
} as const

const RENDERER_UNWATCHED_ROOTS = new Set(['docs', 'dist', 'out', 'native', 'release', 'tests', 'dev-data', 'patches', '.claude', '.tmp', '.reality', '.ui-tour'])

// 根 package.json 是 "type": "module"，但 sandbox:true 的 preload 只支持 CJS，
// 所以 main/preload 显式输出 .cjs（不受根 package.json ESM 默认值影响，与
// scripts/*.cjs 的既有做法一致）；renderer 复用现有 src/ 与 vite.config.ts 的别名配置。
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // ws 必须外置：打包会把它的可选依赖 bufferutil 换成空对象，ws 随后调用不存在的 unmask，收不到任何客户端消息。
        external: ['better-sqlite3', 'ffmpeg-ffprobe-static', '@earendil-works/pi-coding-agent', 'onnxruntime-node', '@techstark/opencv-js', 'uiohook-napi', 'koffi', 'ws'],
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'pi-agent-utility': resolve(__dirname, 'electron/main/pi-agent-utility.ts'),
          // 外部智能体连接的接线员：独立常驻进程，痕迹重启期间替它占住对外端口。
          'mcp-relay': resolve(__dirname, 'electron/main/mcp-relay.ts'),
          'image-color-lut-worker': resolve(__dirname, 'electron/main/image-color-lut-worker.ts'),
          'image-registration-worker': resolve(__dirname, 'electron/main/image-registration-worker.ts'),
          'audio-edit-mask-worker': resolve(__dirname, 'electron/main/services/audio-edit/mask-worker.ts'),
          // 音频编辑导出时离线跑效果链（与试听同一份实现）。
          'audio-edit-effects-worker': resolve(__dirname, 'electron/main/services/audio-edit/effects-worker.ts'),
          // 口水音检测（分块，与时长无关的内存）。
          'audio-edit-mouth-click-worker': resolve(__dirname, 'electron/main/services/audio-edit/mouth-click-worker.ts'),
          'audio-waveform-worker': resolve(__dirname, 'electron/main/services/audio/waveform-worker.ts'),
          'video-screen-change-worker': resolve(__dirname, 'electron/main/services/video/screen-change-worker.ts'),
          'font-worker': resolve(__dirname, 'electron/main/services/fonts/worker.ts'),
          // 本地模型推理后台进程（任务 4.7d，onnxruntime-node 原生推理）。
          'local-inference-utility': resolve(__dirname, 'electron/main/local-inference-utility.ts'),
          'ocr-recognition-worker': resolve(__dirname, 'electron/main/services/local-inference/ocr/recognitionWorker.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  preload: {
    plugins: [replayMainWorld()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          // 隔离 preload 只提供重演 IPC；自包含运行时同步注入页面主世界。
          'web-replay': resolve(__dirname, 'electron/preload/web-replay.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    // 引擎版本插件排在整页刷新之前：引擎源码改动先重算版本，再决定刷新。
    plugins: [react(), videoEditRenderEngineVersion(), reloadOnStatefulModuleUpdate()],
    // 渲染层根目录是仓库根：文档、构建产物、原生工程、测试夹具、并行任务的 worktree 与临时目录不属于渲染层源码，
    // 按顶层目录整个不监听。docs 一项就有上万个文件夹，全量监听让开发服务器启动多花一分多钟（2026-10-26 实测 66 秒降到 10 秒），
    // 还会被编译中被锁住的文件（EBUSY）弄崩 dev server。
    server: { watch: { ignored: [(file: string) => RENDERER_UNWATCHED_ROOTS.has(relative(__dirname, file).split(/[\\/]/)[0])] } },
    // 所有 Worker 都以 { type: 'module' } 创建；ES 格式才允许 Worker 内按需 import（着色器组件逐个懒加载）。
    // Worker 是独立的子构建，产物在主包生成阶段以同一 assets 目录的固定文件名并入；同一模块在两边内容相同时
    // （如只导出数据的 glTransitionShaders.generated）文件名也相同，并入会覆盖主包的同名 chunk，主包随后读不到它的依赖而构建失败
    // （2026-10-27）。Worker 产物统一在哈希后带 .worker 后缀：主包文件名的哈希后紧跟唯一扩展名，哈希不含点号，两边不可能同名。
    // 门禁 scripts/check-renderer-output-names.cjs 校验这条约定。
    worker: { format: 'es', rollupOptions: { output: RENDERER_WORKER_OUTPUT_NAMES } },
    optimizeDeps: {
      // 启动时扫描全部渲染层源码（含懒加载子树与 Worker），三方库一次预构建完。只扫入口时，
      // Vite 会等第一次用到某个库才现场预构建并整页刷新，开发运行就和正式版不一样（2026-10-26）。
      // 测试与测试夹具引用 vitest 等只在 Node 里跑的库，不扫。
      entries: ['index.html', 'src/**/*.{ts,tsx}', '!src/tests/**', '!src/**/*.test.{ts,tsx}', '!src/**/*.testSupport.ts', '!src/**/*TestKit.ts', '!src/**/*TestUtils.ts', '!src/**/*TestFixture*.ts'],
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
        output: RENDERER_OUTPUT_NAMES,
        // 任何产物同名覆盖都直接失败并指明文件，不再留到后续插件读到被覆盖的产物才报含糊的错误。
        onwarn(warning, warn) {
          if (warning.code === 'FILE_NAME_CONFLICT') throw new Error(`渲染层产物同名覆盖：${warning.message}。主包与 Worker 子构建的产物命名必须互不相交（见 electron.vite.config.ts 的 RENDERER_WORKER_OUTPUT_NAMES）。`)
          warn(warning)
        },
      },
    },
  },
})
