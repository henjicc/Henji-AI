import { ipcMain } from 'electron'
import type { ReplayBoot } from '../../../../../packages/web-replay-probe/src/replay/types'

export type ReplayBootReply = { phase: 'bootstrap'; storage: unknown } | { phase: 'app'; boot: ReplayBoot } | { phase: 'reader' } | { phase: 'none' }

const routes = new Map<number, (url: string) => ReplayBootReply>()
let installed = false

/** reader 也被网页缓存独立使用；同步启动应答不能依赖重演播放器是否启动。 */
export function registerReplayBoot(contentsId: number, boot: (url: string) => ReplayBootReply): () => void {
  if (!installed) {
    installed = true
    ipcMain.on('web-replay:boot', (event, url: unknown) => { event.returnValue = routes.get(event.sender.id)?.(String(url)) ?? { phase: 'none' } })
  }
  routes.set(contentsId, boot)
  return () => { if (routes.get(contentsId) === boot) routes.delete(contentsId) }
}
