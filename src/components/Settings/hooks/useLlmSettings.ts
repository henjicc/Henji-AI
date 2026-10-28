import { createLogger } from '@/core/logging'
import type { LlmConfigState, LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import {
  llmGetProviderKeyStatus,
} from '@/commands/llmRuntime'
import { llmConfigService } from '@/services/llm'
import type { LlmCredentialMutationDto, LlmProviderSettingsResultDto } from '@/platform/contracts/llmRuntime'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiKeySaveErrorKey } from './useApiKeys'

const logger = createLogger('components.Settings.hooks.useLlmSettings')

type KeyMap = Record<string, string>
type VisibilityMap = Record<string, boolean>
type StatusMap = Record<string, boolean>

export interface UseLlmSettingsResult {
  config: LlmConfigState
  hints: KeyMap
  keys: KeyMap
  keyErrors: KeyMap
  visibility: VisibilityMap
  status: StatusMap
  loading: boolean
  updateKey: (providerId: string, value: string) => void
  saveKey: (providerId: string) => Promise<void>
  clearKey: (providerId: string) => void
  toggleVisibility: (providerId: string) => void
  saveConfig: (config: LlmConfigState) => Promise<void>
  commitProviderSettings: (
    provider: LlmProviderConfig,
    seedModels: LlmModelConfig[],
    credential: LlmCredentialMutationDto,
  ) => Promise<LlmProviderSettingsResultDto>
  deleteProviderSettings: (providerId: string) => Promise<LlmProviderSettingsResultDto>
}

export function useLlmSettings(): UseLlmSettingsResult {
  const [config, setConfig] = useState<LlmConfigState>(createDefaultLlmConfig())
  const [hints, setHints] = useState<KeyMap>({})
  const [keys, setKeys] = useState<KeyMap>({})
  const [keyErrors, setKeyErrors] = useState<KeyMap>({})
  const [visibility, setVisibility] = useState<VisibilityMap>({})
  const [status, setStatus] = useState<StatusMap>({})
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(false)

  const credentialIds = useMemo(
    () => [...new Set(config.providers.map(provider => provider.credentialId ?? provider.providerId))],
    [config.providers]
  )

  useEffect(() => {
    let disposed = false
    mountedRef.current = true
    const bootstrap = async (): Promise<void> => {
      try {
        const loadedConfig = await llmConfigService.getConfig()
        if (disposed) return
        setConfig(loadedConfig)
      } catch (error) {
        logger.error('[useLlmSettings] load config failed', error)
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void bootstrap()
    return () => {
      disposed = true
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (credentialIds.length === 0) return
    let disposed = false
    const loadKeys = async (): Promise<void> => {
      try {
        const statuses = await llmGetProviderKeyStatus(credentialIds)
        if (disposed) return
        const statusByCredential = new Map(statuses.map(item => [item.credentialId, item]))
        const nextStatus: StatusMap = {}
        const nextHints: KeyMap = {}
        config.providers.forEach(provider => {
          const credentialId = provider.credentialId ?? provider.providerId
          const configured = statusByCredential.get(credentialId)?.configured === true
          nextStatus[provider.providerId] = configured
          if (configured) {
            nextHints[provider.providerId] = statusByCredential.get(credentialId)?.maskedHint ?? '••••'
          }
        })
        if (disposed) return
        setStatus(nextStatus)
        setHints(nextHints)
      } catch (error) {
        logger.error('[useLlmSettings] load key status failed', error)
      }
    }
    void loadKeys()
    return () => { disposed = true }
  }, [config.providers, credentialIds])

  const refreshProviderKey = async (providerId: string): Promise<void> => {
    const provider = config.providers.find(item => item.providerId === providerId)
    if (!provider) return
    const credentialId = provider.credentialId ?? provider.providerId
    const [statusItem] = await llmGetProviderKeyStatus([credentialId])
    const configured = statusItem?.configured === true
    const hint = configured ? statusItem.maskedHint ?? '••••' : ''
    if (!mountedRef.current) return
    const affectedProviderIds = config.providers
      .filter(item => (item.credentialId ?? item.providerId) === credentialId)
      .map(item => item.providerId)
    setStatus(prev => Object.assign({}, prev, ...affectedProviderIds.map(id => ({ [id]: configured }))))
    setHints(prev => Object.assign({}, prev, ...affectedProviderIds.map(id => ({ [id]: hint }))))
  }

  const persistKey = async (providerId: string, value: string, remove = false): Promise<void> => {
    try {
      const trimmed = value.trim()
      if (!remove && !trimmed) return
      const provider = config.providers.find(item => item.providerId === providerId)
      if (!provider) throw new Error(`Provider "${providerId}" is no longer available; reload settings and retry`)
      await llmConfigService.commitProviderSettings(
        provider,
        [],
        remove ? { kind: 'remove' } : { kind: 'set', apiKey: trimmed }
      )
      if (mountedRef.current) {
        setKeys(prev => prev[providerId] === value ? { ...prev, [providerId]: '' } : prev)
        await refreshProviderKey(providerId)
        if (mountedRef.current) setKeyErrors(prev => { const next = { ...prev }; delete next[providerId]; return next })
      }
    } catch (error) {
      logger.error(`[useLlmSettings] update key failed: ${providerId}`, error)
      if (mountedRef.current) setKeyErrors(prev => ({ ...prev, [providerId]: apiKeySaveErrorKey(error) }))
    }
  }

  const toggleVisibility = (providerId: string): void => {
    setVisibility(prev => ({ ...prev, [providerId]: !prev[providerId] }))
  }

  const saveConfig = async (nextConfig: LlmConfigState): Promise<void> => {
    await llmConfigService.saveConfig(nextConfig)
    setConfig(nextConfig)
  }

  const commitProviderSettings = async (
    provider: LlmProviderConfig,
    seedModels: LlmModelConfig[],
    credential: LlmCredentialMutationDto,
  ): Promise<LlmProviderSettingsResultDto> => {
    const result = await llmConfigService.commitProviderSettings(provider, seedModels, credential)
    setConfig(result.config)
    setStatus(prev => ({ ...prev, [result.providerId]: result.configured }))
    return result
  }

  const deleteProviderSettings = async (providerId: string): Promise<LlmProviderSettingsResultDto> => {
    const result = await llmConfigService.deleteProviderSettings(providerId)
    setConfig(result.config)
    setKeys(prev => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
    setStatus(prev => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
    return result
  }

  useEffect(() => {
    const reloadConfig = (): void => {
      void (async () => {
        try {
          const loadedConfig = await llmConfigService.getConfig()
          setConfig(loadedConfig)
        } catch (error) {
          logger.error('[useLlmSettings] reload config failed', error)
        }
      })()
    }
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, reloadConfig)
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, reloadConfig)
  }, [])

  return {
    config,
    keys,
    hints,
    keyErrors,
    visibility,
    status,
    loading,
    updateKey: (providerId, value) => {
      setKeys(prev => ({ ...prev, [providerId]: value }))
      setKeyErrors(prev => { const next = { ...prev }; delete next[providerId]; return next })
    },
    saveKey: providerId => persistKey(providerId, keys[providerId] ?? ''),
    clearKey: providerId => {
      setKeys(prev => ({ ...prev, [providerId]: '' }))
      void persistKey(providerId, '', true)
    },
    toggleVisibility,
    saveConfig,
    commitProviderSettings,
    deleteProviderSettings,
  }
}
