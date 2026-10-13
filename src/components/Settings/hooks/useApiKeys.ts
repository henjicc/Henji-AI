import { createLogger } from '@/core/logging'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import {
  aiGetProviderApiKey,
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
  visibility: ApiKeyVisibility
  errors: Partial<Record<ApiKeyProvider, string>>
  updateKey: (provider: ApiKeyProvider, value: string) => void
  toggleVisibility: (provider: ApiKeyProvider) => void
}

const WRITE_DEBOUNCE_MS = 450

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
  const [visibility, setVisibility] = useState<ApiKeyVisibility>(createVisibilityState())
  const [errors, setErrors] = useState<Partial<Record<ApiKeyProvider, string>>>({})
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({})
  const pendingRef = useRef<Partial<Record<ApiKeyProvider, string>>>({})
  const editedRef = useRef(new Set<ApiKeyProvider>())
  const mountedRef = useRef(false)
  const setProviderKeyStatus = useSettingsStore((state) => state.setProviderKeyStatus)

  const persistKey = useCallback(async (provider: ApiKeyProvider, value: string): Promise<void> => {
    try {
      const trimmed = value.trim()
      if (trimmed) await aiSetProviderApiKey(provider, trimmed)
      else await aiRemoveProviderApiKey(provider)
      setProviderKeyStatus(provider, Boolean(trimmed))
      emitApplicationEvent(trimmed ? 'provider-key-configured' : 'provider-key-removed', { providerId: provider })
      if (mountedRef.current) setErrors(prev => ({ ...prev, [provider]: undefined }))
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
        // 状态同步与写回 store 复用启动时的同一个函数，这里只额外取密钥明文用于回填输入框
        const statusMap = await syncProviderKeyStatuses()
        if (disposed) return

        const loadedKeys = createEmptyKeys()
        const configuredProviders: ApiKeyProvider[] = []

        Object.entries(statusMap).forEach(([providerId, configured]) => {
          if (configured && providerId in loadedKeys) {
            configuredProviders.push(providerId as ApiKeyProvider)
          }
        })

        const loadedValues = await Promise.all(
          configuredProviders.map(async (providerId) => {
            try {
              const apiKey = await aiGetProviderApiKey(providerId)
              return [providerId, apiKey ?? ''] as const
            } catch (error) {
              logger.error(`[useApiKeys] load key failed: ${providerId}`, error)
              return [providerId, ''] as const
            }
          })
        )

        if (disposed) return

        loadedValues.forEach(([providerId, apiKey]) => {
          loadedKeys[providerId] = apiKey
        })

        setKeys(prev => Object.assign(loadedKeys, ...[...editedRef.current].map(id => ({ [id]: prev[id] }))))
      } catch (error) {
        logger.error('[useApiKeys] load key status failed', error)
      }
    }

    void bootstrap()
    const timers = timersRef.current
    const pending = pendingRef.current

    return () => {
      disposed = true
      mountedRef.current = false
      Object.values(timers).forEach((timer) => {
        if (timer) clearTimeout(timer)
      })
      for (const [provider, value] of Object.entries(pending)) {
        delete pending[provider as ApiKeyProvider]
        void persistKey(provider as ApiKeyProvider, value)
      }
    }
  }, [persistKey])

  const updateKey = (provider: ApiKeyProvider, value: string) => {
    setKeys((prev) => ({ ...prev, [provider]: value }))
    editedRef.current.add(provider)
    setErrors(prev => ({ ...prev, [provider]: undefined }))
    pendingRef.current[provider] = value

    const existingTimer = timersRef.current[provider]
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    timersRef.current[provider] = setTimeout(() => {
      delete pendingRef.current[provider]
      delete timersRef.current[provider]
      void persistKey(provider, value)
    }, WRITE_DEBOUNCE_MS)
  }

  const toggleVisibility = (provider: ApiKeyProvider) => {
    setVisibility((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  return { keys, visibility, errors, updateKey, toggleVisibility }
}
