import { relative, resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

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
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          // 网页录制重演的离屏窗口专用（contextIsolation:false，在页面自身环境里先于页面脚本运行）。
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
    plugins: [react(), reloadOnStatefulModuleUpdate()],
    // 渲染层根目录是仓库根：文档、构建产物、原生工程、测试夹具、并行任务的 worktree 与临时目录不属于渲染层源码，
    // 按顶层目录整个不监听。docs 一项就有上万个文件夹，全量监听让开发服务器启动多花一分多钟（2026-10-26 实测 66 秒降到 10 秒），
    // 还会被编译中被锁住的文件（EBUSY）弄崩 dev server。
    server: { watch: { ignored: [(file: string) => RENDERER_UNWATCHED_ROOTS.has(relative(__dirname, file).split(/[\\/]/)[0])] } },
    // 所有 Worker 都以 { type: 'module' } 创建；ES 格式才允许 Worker 内按需 import（着色器组件逐个懒加载）。
    worker: { format: 'es' },
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
      },
    },
  },
})
