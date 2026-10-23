/**
 * Preload for the offscreen replay window only (contextIsolation:false, so it runs in the page's
 * own world before any page script). It bridges the probe's replay runtime to the main-process
 * player over IPC. Type-checked with the probe package (DOM), not tsconfig.electron.json.
 */
import { ipcRenderer } from 'electron'
import { installReplayRuntime } from '../../packages/web-replay-probe/src/replay/runtime'
import type { ReplayBoot, ReplayReport } from '../../packages/web-replay-probe/src/replay/types'
import type { StorageSnapshot } from '../../packages/web-replay-probe/src/protocol'
import { restoreStorage } from '../../packages/web-replay-probe/src/shared/storage'

type BootReply = { phase: 'bootstrap'; storage: StorageSnapshot } | { phase: 'app'; boot: ReplayBoot } | { phase: 'none' }

const report = (value: ReplayReport): void => ipcRenderer.send('web-replay:report', value)
const reply = ipcRenderer.sendSync('web-replay:boot', location.href) as BootReply

if (reply.phase === 'bootstrap') {
  restoreStorage(reply.storage).then(
    () => ipcRenderer.send('web-replay:bootstrapped'),
    error => { report({ kind: 'conflict', t: 0, message: `页面存储恢复失败：${String(error)}` }); ipcRenderer.send('web-replay:bootstrapped') },
  )
} else if (reply.phase === 'app') {
  installReplayRuntime({
    boot: reply.boot,
    http: request => ipcRenderer.invoke('web-replay:http', request),
    invoke: (command, args) => ipcRenderer.invoke('web-replay:invoke', command, args),
    report,
  })
}
