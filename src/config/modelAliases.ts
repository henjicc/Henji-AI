/**
 * 模型别名：用户自定义的模型显示名称，按 canonicalModelId 统一生效，
 * 同一模型无论由哪个供应商接入都共用同一个别名，只影响 UI 展示。
 */

const STORAGE_KEY = 'model_aliases'

export function getModelAliases(): Record<string, string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function saveModelAliases(aliases: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(aliases))
}

export function getModelAlias(canonicalModelId: string): string {
  return getModelAliases()[canonicalModelId]?.trim() || ''
}

export function setModelAlias(canonicalModelId: string, alias: string): void {
  const aliases = getModelAliases()
  const trimmed = alias.trim()
  if (trimmed) {
    aliases[canonicalModelId] = trimmed
  } else {
    delete aliases[canonicalModelId]
  }
  saveModelAliases(aliases)
  // 复用模型目录变更的既有广播通道（隐藏/别名都属于"模型展示信息变了"），
  // 不新开广播通道，参见 generationModelFields.ts 里的说明。
  window.dispatchEvent(new Event('modelVisibilityChanged'))
}
