/**
 * 更新检测配置管理
 * 管理更新检测的设置和忽略的版本
 */

export interface UpdateConfig {
  enabled: boolean // 是否启用更新检测
  frequency: 'startup' | 'daily' | 'weekly' | 'never' // 检测频率
  lastCheckTime: number // 上次检查时间戳
  ignoredVersions: string[] // 用户选择忽略的版本列表
}

const UPDATE_CONFIG_KEY = 'update_config'
const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  frequency: 'startup',
  lastCheckTime: 0,
  ignoredVersions: []
}

/**
 * 获取更新配置
 */
export function getUpdateConfig(): UpdateConfig {
  try {
    const stored = localStorage.getItem(UPDATE_CONFIG_KEY)
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.error('读取更新配置失败:', error)
  }
  return DEFAULT_CONFIG
}

/**
 * 保存更新配置
 */
export function saveUpdateConfig(config: Partial<UpdateConfig>): void {
  try {
    const current = getUpdateConfig()
    const updated = { ...current, ...config }
    localStorage.setItem(UPDATE_CONFIG_KEY, JSON.stringify(updated))
  } catch (error) {
    console.error('保存更新配置失败:', error)
  }
}

/**
 * 设置是否启用更新检测
 */
export function setUpdateEnabled(enabled: boolean): void {
  saveUpdateConfig({ enabled })
}

/**
 * 设置更新检测频率
 */
export function setUpdateFrequency(frequency: UpdateConfig['frequency']): void {
  saveUpdateConfig({ frequency })
}

/**
 * 更新最后检查时间
 */
export function updateLastCheckTime(): void {
  saveUpdateConfig({ lastCheckTime: Date.now() })
}

/**
 * 添加忽略的版本
 */
export function addIgnoredVersion(version: string): void {
  const config = getUpdateConfig()
  if (!config.ignoredVersions.includes(version)) {
    saveUpdateConfig({
      ignoredVersions: [...config.ignoredVersions, version]
    })
  }
}

/**
 * 检查版本是否被忽略
 */
export function isVersionIgnored(version: string): boolean {
  const config = getUpdateConfig()
  return config.ignoredVersions.includes(version)
}

/**
 * 清除忽略的版本列表
 */
export function clearIgnoredVersions(): void {
  saveUpdateConfig({ ignoredVersions: [] })
}

/**
 * 判断是否应该检查更新
 */
export function shouldCheckForUpdates(): boolean {
  const config = getUpdateConfig()

  // 如果禁用了更新检测
  if (!config.enabled) {
    return false
  }

  // 如果设置为从不检查
  if (config.frequency === 'never') {
    return false
  }

  // 如果设置为启动时检查
  if (config.frequency === 'startup') {
    return true
  }

  const now = Date.now()
  const lastCheck = config.lastCheckTime

  // 如果从未检查过
  if (lastCheck === 0) {
    return true
  }

  const timeDiff = now - lastCheck

  // 每日检查：距离上次检查超过 24 小时
  if (config.frequency === 'daily') {
    return timeDiff > 24 * 60 * 60 * 1000
  }

  // 每周检查：距离上次检查超过 7 天
  if (config.frequency === 'weekly') {
    return timeDiff > 7 * 24 * 60 * 60 * 1000
  }

  return false
}

/**
 * 获取频率的显示文本
 */
export function getFrequencyLabel(frequency: UpdateConfig['frequency']): string {
  const labels: Record<UpdateConfig['frequency'], string> = {
    startup: '每次启动时',
    daily: '每天',
    weekly: '每周',
    never: '从不'
  }
  return labels[frequency]
}
