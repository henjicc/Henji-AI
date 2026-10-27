import { searchAppStoreIcons, saveAppStoreIcon } from '@/commands/assetLibrary'
import { saveAppStoreIconSchema, searchAppStoreIconsSchema } from '@/core/appStoreIcons'
import { currentDocumentContext } from '@/features/documents'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control'

export function registerAppStoreIconHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler('search_app_store_icons', async (raw, context) => {
    context.signal.throwIfAborted()
    return { ...await searchAppStoreIcons(searchAppStoreIconsSchema.parse(raw)) }
  })
  registrar.registerHandler('save_app_store_icon', async (raw, context) => {
    context.signal.throwIfAborted()
    const input = saveAppStoreIconSchema.parse(raw)
    // 在第一次异步等待前绑定项目；下载期间切换页面不会改变保存目标。
    const projectId = input.projectId ?? currentDocumentContext().projectId
    return { ...await saveAppStoreIcon({ ...input, projectId }) }
  })
}
