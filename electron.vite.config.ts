import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 根 package.json 是 "type": "module"，但 sandbox:true 的 preload 只支持 CJS，
// 所以 main/preload 显式输出 .cjs（不受根 package.json ESM 默认值影响，与
// scripts/*.cjs 的既有做法一致）；renderer 复用现有 src/ 与 vite.config.ts 的别名配置。
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['better-sqlite3', 'ffmpeg-ffprobe-static'],
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'agent-utility': resolve(__dirname, 'electron/main/agent-utility.ts'),
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
    plugins: [react()],
    optimizeDeps: {
      // 这些三方库只出现在懒加载子树里（工具箱 3D/图片编辑、画布、提示词编辑器等）。
      // 不显式登记时 Vite 会等用户第一次切到对应 Tab 才现场预构建依赖，
      // 表现就是「切个 Tab 卡十几秒、还可能整页刷新」。登记后在 dev server 起来时一次性预构建。
      include: [
        '@tiptap/core',
        '@tiptap/extension-document',
        '@tiptap/extension-hard-break',
        '@tiptap/extension-paragraph',
        '@tiptap/extension-text',
        '@tiptap/extensions/character-count',
        '@tiptap/extensions/placeholder',
        '@tiptap/extensions/undo-redo',
        '@tiptap/pm/model',
        '@tiptap/pm/state',
        '@tiptap/pm/view',
        '@tiptap/react',
        '@tiptap/suggestion',
        '@react-three/drei',
        '@react-three/fiber',
        'dockview-react',
        'konva',
        'konva/lib/Node',
        'pica',
        'react-konva',
        'react-virtuoso',
        'three',
        'three-stdlib',
      ],
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
