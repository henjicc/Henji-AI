import { useEffect } from 'react'
import { findAppMenuCommand, getAppMenus, subscribeAppMenus, toNativeAppMenu } from '@/core/appMenu/appMenu'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('components.appMenu')

/** 原生菜单只传模型；执行时重新找命令，避免旧菜单引用已经撤回的工作区。 */
export function useNativeAppMenus(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const platform = getPlatform().appMenu
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void platform.update(toNativeAppMenu(getAppMenus())).catch(error => {
          logger.error('原生菜单同步失败', { event: 'app_menu.sync_failed', error })
        })
      }, 50)
    }
    const unsubscribe = subscribeAppMenus(sync)
    const unlisten = platform.onInvoke(({ id }) => {
      const command = findAppMenuCommand(id)
      if (!command || command.disabledReason) return
      const fail = (error: unknown): void => logger.error('菜单项执行失败', { event: 'app_menu.run_failed', error, context: { id } })
      try { void Promise.resolve(command.run()).catch(fail) } catch (error) { fail(error) }
    })
    // 失焦期间的更新会被主进程拒绝；重新聚焦时发送当前完整模型。
    window.addEventListener('focus', sync)
    sync()
    return () => { clearTimeout(timer); unsubscribe(); unlisten(); window.removeEventListener('focus', sync) }
  }, [enabled])
}
