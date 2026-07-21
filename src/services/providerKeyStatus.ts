import { createLogger } from '@/core/logging'
import { aiGetProviderKeyStatus } from '@/commands/aiRuntime'
import { useSettingsStore, type ProviderKeyStatusMap } from '@/stores/settingsStore'

const logger = createLogger('services.providerKeyStatus')

/**
 * 从主进程拉取各供应商密钥配置状态并写回 settingsStore。
 *
 * 必须在应用启动时调用一次：settingsStore 里的 providerKeyStatus 是持久化字段，
 * 不同步就会拿旧值去判断"有没有配密钥"——画布节点因此会在密钥其实存在时
 * 误报缺少 API Key（打开一次设置面板才被动修正）。
 */
export async function syncProviderKeyStatuses(): Promise<ProviderKeyStatusMap> {
  try {
    const statusList = await aiGetProviderKeyStatus()
    const statusMap: ProviderKeyStatusMap = {}
    statusList.forEach((item) => {
      statusMap[item.providerId] = item.configured
    })
    useSettingsStore.getState().setProviderKeyStatuses(statusMap)
    return statusMap
  } catch (error) {
    logger.error('provider_key_status.sync.failed', { error: String(error) })
    return {}
  }
}
