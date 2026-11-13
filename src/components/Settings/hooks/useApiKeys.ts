import { createLogger } from '@/core/logging'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import {
  aiGetProviderKeyInfo,
  aiRemoveProviderApiKey,
  aiSetProviderApiKey,
} from '@/commands/aiRuntime'
import { useSettingsStore } from '@/stores/settingsStore'
import { syncProviderKeyStatuses } from '@/services/providerKeyStatus'
import { emitApplicationEvent } from '@/core/events/applicationEvents'

const logger = createLogger('components.Settings.hooks.useApiKeys')

type ApiKeys = Record<ApiKeyProvider, string>
type ApiKeyVisibility = Record<ApiKeyProvider, boolean>

export interface UseApiKeysResult {
  keys: ApiKeys
  hints: Partial<Record<ApiKeyProvider, string>>
  visibility: ApiKeyVisibility
  errors: Partial<Record<ApiKeyProvider, string>>
  updateKey: (provider: ApiKeyProvider, value: string) => void
  saveKey: (provider: ApiKeyProvider) => Promise<void>
  clearKey: (provider: ApiKeyProvider) => void
  toggleVisibility: (provider: ApiKeyProvider) => void
}

export function apiKeySaveErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/safeStorage.*(?:not available|unavailable)/i.test(message)) return 'apiKeys.errors.encryptionUnavailable'
  // 文件路径里的 .json 不代表解析失败，写入失败应提示检查权限和空间。
  if (error instanceof SyntaxError
    || /Invalid keystore file format|decrypt|(?:unexpected|expected|unterminated|bad|not valid)[^\n]*\bJSON\b|\bJSON[ .](?:parse|syntax)/i.test(message)) {
    return 'apiKeys.errors.unreadable'
  }
  return 'apiKeys.errors.saveFailed'
}

const createEmptyKeys = (): ApiKeys => {
  return API_KEY_PROVIDERS.reduce((acc, provider) => {
    acc[provider.id] = ''
    return acc
  }, {} as ApiKeys)
}

const createVisibilityState = (): ApiKeyVisibility => {
  return API_KEY_PROVIDERS.reduce((acc, provider) => {
    acc[provider.id] = false
    return acc
  }, {} as ApiKeyVisibility)
}

export function useApiKeys(): UseApiKeysResult {
  const [keys, setKeys] = useState<ApiKeys>(createEmptyKeys())
  const [hints, setHints] = useState<Partial<Record<ApiKeyProvider, string>>>({})
  const [visibility, setVisibility] = useState<ApiKeyVisibility>(createVisibilityState())
  const [errors, setErrors] = useState<Partial<Record<ApiKeyProvider, string>>>({})
  const savedRef = useRef(new Set<ApiKeyProvider>())
  const mountedRef = useRef(false)
  const setProviderKeyStatus = useSettingsStore((state) => state.setProviderKeyStatus)

  const persistKey = useCallback(async (provider: ApiKeyProvider, value: string, remove = false): Promise<void> => {
    try {
      const trimmed = value.trim()
      if (remove) await aiRemoveProviderApiKey(provider)
      else if (trimmed) await aiSetProviderApiKey(provider, trimmed)
      else return
      savedRef.current.add(provider)
      setProviderKeyStatus(provider, Boolean(trimmed))
      emitApplicationEvent(trimmed ? 'provider-key-configured' : 'provider-key-removed', { providerId: provider })
      const info = await aiGetProviderKeyInfo(provider)
      if (mountedRef.current) {
        setHints(prev => ({ ...prev, [provider]: info.maskedHint ?? undefined }))
        setErrors(prev => ({ ...prev, [provider]: undefined }))
      }
    } catch (error) {
      logger.error(`[useApiKeys] update key failed: ${provider}`, error)
      if (mountedRef.current) setErrors(prev => ({ ...prev, [provider]: apiKeySaveErrorKey(error) }))
    }
  }, [setProviderKeyStatus])

  useEffect(() => {
    let disposed = false
    mountedRef.current = true

    const bootstrap = async (): Promise<void> => {
      try {
        // 输入框只保存待替换值，已保存凭据只读取摘要。
        await syncProviderKeyStatuses()
        if (disposed) return

        const loadedHints = createEmptyKeys()
        // 未配置的也要问：存着密文却解不开时要提示重新填写
        const loadedValues = await Promise.all(
          API_KEY_PROVIDERS.map(async ({ id: providerId }) => {
            try {
              const info = await aiGetProviderKeyInfo(providerId)
              return [providerId, info.maskedHint ?? '', info.unreadable] as const
            } catch (error) {
              logger.error(`[useApiKeys] load key failed: ${providerId}`, error)
              return [providerId, '', false] as const
            }
          })
        )

        if (disposed) return

        loadedValues.forEach(([providerId, hint]) => {
          loadedHints[providerId] = hint
        })
        const unreadable = loadedValues.filter(([providerId, , flag]) => flag && !savedRef.current.has(providerId)).map(([providerId]) => providerId)

        setHints(prev => Object.assign(loadedHints, ...[...savedRef.current].map(id => ({ [id]: prev[id] }))))
        if (unreadable.length) setErrors(prev => Object.assign({}, prev, ...unreadable.map(id => ({ [id]: prev[id] ?? 'apiKeys.errors.storedUnreadable' }))))
      } catch (error) {
        logger.error('[useApiKeys] load key status failed', error)
      }
    }

    void bootstrap()
    return () => {
      disposed = true
      mountedRef.current = false
    }
  }, [persistKey])

  const updateKey = (provider: ApiKeyProvider, value: string) => {
    setKeys((prev) => ({ ...prev, [provider]: value }))
    setErrors(prev => ({ ...prev, [provider]: undefined }))
  }

  const toggleVisibility = (provider: ApiKeyProvider) => {
    setVisibility((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  const clearKey = (provider: ApiKeyProvider): void => {
    setKeys(prev => ({ ...prev, [provider]: '' }))
    void persistKey(provider, '', true)
  }

  return { keys, hints, visibility, errors, updateKey, saveKey: provider => persistKey(provider, keys[provider]), clearKey, toggleVisibility }
}
