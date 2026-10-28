/** 时钟和页面拦截必须先于页面脚本安装；IPC 与 GPU 取帧留在隔离世界。 */
import { contextBridge, ipcRenderer } from 'electron'
import installReplayMainWorld from 'virtual:henji-replay-main-world'
import type { ReplayBoot, ReplayHost, ReplayReport } from '../../packages/web-replay-probe/src/replay/types'
import type { StorageSnapshot } from '../../packages/web-replay-probe/src/protocol'
import { restoreStorage } from '../../packages/web-replay-probe/src/shared/storage'
import { installReplayReader } from './web-replay-reader'

type BootReply = { phase: 'bootstrap'; storage: StorageSnapshot } | { phase: 'app'; boot: ReplayBoot } | { phase: 'reader' } | { phase: 'none' }

const report = (value: ReplayReport): void => ipcRenderer.send('web-replay:report', value)
const reply = ipcRenderer.sendSync('web-replay:boot', location.href) as BootReply

if (reply.phase === 'bootstrap') {
  restoreStorage(reply.storage).then(
    () => ipcRenderer.send('web-replay:bootstrapped'),
    error => { report({ kind: 'conflict', t: 0, message: `页面存储恢复失败：${String(error)}` }); ipcRenderer.send('web-replay:bootstrapped') },
  )
} else if (reply.phase === 'reader') {
  try {
    installReplayReader()
  } catch (error) {
    ipcRenderer.send('web-replay:reader-ready', { ok: false, error: `重演取帧运行时注入失败：${String(error)}` })
  }
} else if (reply.phase === 'app') {
  const host: ReplayHost = {
    boot: reply.boot,
    http: request => ipcRenderer.invoke('web-replay:http', request),
    invoke: (command, args, t) => ipcRenderer.invoke('web-replay:invoke', command, args, t),
    report,
  }
  try {
    contextBridge.executeInMainWorld({ func: installReplayMainWorld, args: [host] })
  } catch (error) {
    report({ kind: 'failed', message: `重演运行时注入失败：${String(error)}` })
  }
}
