import { defineConfig } from 'vite'
import path from 'path'

// 内置效果的开发预览页：直接调用剪辑的正式效果执行器，独立端口，不经过 Electron。
export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  server: { port: 5288, strictPort: true, fs: { allow: [path.resolve(__dirname, '../..')] } },
})
