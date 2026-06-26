import { contextBridge } from 'electron'

// 2.1 阶段仅搭骨架：真正的 henjiNative 白名单 API 由 2.3 任务填充。
contextBridge.exposeInMainWorld('henjiNative', {})
