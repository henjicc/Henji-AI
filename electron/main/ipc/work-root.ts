import { WORK_ROOT_IPC_CHANNELS, type WorkRootTarget } from '../../../src/platform/contracts/workRoot'
import { getWorkRootService, openWorkRoot, relaunchAfterWorkRootChange } from '../services/work-root/runtime'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'
import { approveAllWindowsClose } from './window'

/*
 * 作品目录 IPC（任务 4.2）：渲染层经 preload `henjiNative.workRoot` → PAL `WorkRootPlatform`
 * → `src/commands/workRoot.ts` 调用。移动进度经 `workRoot:progress` 事件推给发起的窗口。
 */

export function parseWorkRootTarget(input: unknown): WorkRootTarget {
  const record = parseRecord(input)
  if (record.kind === 'default' && Object.keys(record).length === 1) return { kind: 'default' }
  if (record.kind === 'custom' && typeof record.folder === 'string' && record.folder.trim() && Object.keys(record).length === 2) {
    return { kind: 'custom', folder: record.folder.trim() }
  }
  throw new Error('Expected work root target { kind: "default" } or { kind: "custom", folder }')
}

export function registerWorkRootIpc(): void {
  const c = WORK_ROOT_IPC_CHANNELS
  registerIpcHandler(c.getInfo, parseVoid, () => getWorkRootService().getInfo())
  registerIpcHandler(c.inspectTarget, parseWorkRootTarget, (target) => getWorkRootService().inspectTarget(target))
  registerIpcHandler(c.change, parseWorkRootTarget, (target, event) => getWorkRootService().change(target, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send(c.progress, progress)
  }))
  registerIpcHandler(c.cancel, parseVoid, () => getWorkRootService().cancel())
  registerIpcHandler(c.open, parseVoid, () => openWorkRoot())
  registerIpcHandler(c.relaunch, parseVoid, () => { relaunchAfterWorkRootChange(approveAllWindowsClose) })
}
