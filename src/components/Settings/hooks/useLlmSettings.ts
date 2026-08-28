import { createLogger } from '@/core/logging'
import type { LlmConfigState } from '@henjicc/ai-sdk'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import {
  llmGetProviderApiKey,
  llmGetProviderKeyStatus,
} from '@/commands/llmRuntime'
import { llmConfigService } from '@/services/llm'
import { useEffect, useMemo, useRef, useState } from 'react'

const logger = createLogger('components.Settings.hooks.useLlmSettings')
const WRITE_DEBOUNCE_MS = 450

type KeyMap = Record<string, string>
type VisibilityMap = Record<string, boolean>
type StatusMap = Record<string, boolean>

export interface UseLlmSettingsResult {
  config: LlmConfigState
  keys: KeyMap
  visibility: VisibilityMap
  status: StatusMap
  loading: boolean
  updateKey: (providerId: string, value: string) => void
  toggleVisibility: (providerId: string) => void
  saveConfig: (config: LlmConfigState) => Promise<void>
}

export function useLlmSettings(): UseLlmSettingsResult {
  const [config, setConfig] = useState<LlmConfigState>(createDefaultLlmConfig())
  const [keys, setKeys] = useState<KeyMap>({})
  const [visibility, setVisibility] = useState<VisibilityMap>({})
  const [status, setStatus] = useState<StatusMap>({})
  const [loading, setLoading] = useState(true)
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({})

  const credentialIds = useMemo(
    () => [...new Set(config.providers.map(provider => provider.credentialId ?? provider.providerId))],
    [config.providers]
  )

  useEffect(() => {
    let disposed = false
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
    const timers = timersRef.current
    return () => {
      disposed = true
      Object.values(timers).forEach(timer => {
        if (timer) clearTimeout(timer)
      })
    }
  }, [])

  useEffect(() => {
    if (credentialIds.length === 0) return
    let disposed = false
    const loadKeys = async (): Promise<void> => {
      try {
        const statuses = await llmGetProviderKeyStatus(credentialIds)
        if (disposed) return
        const statusByCredential = new Map(statuses.map(item => [item.credentialId, item.configured]))
        const nextStatus: StatusMap = {}
        const nextKeys: KeyMap = {}
        await Promise.all(config.providers.map(async provider => {
          const credentialId = provider.credentialId ?? provider.providerId
          const configured = statusByCredential.get(credentialId) === true
          nextStatus[provider.providerId] = configured
          if (configured) {
            nextKeys[provider.providerId] = await llmGetProviderApiKey(credentialId) ?? ''
          }
        }))
        if (disposed) return
        setStatus(nextStatus)
        setKeys(prev => ({ ...prev, ...nextKeys }))
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
    const apiKey = configured ? (await llmGetProviderApiKey(credentialId)) ?? '' : ''
    const affectedProviderIds = config.providers
      .filter(item => (item.credentialId ?? item.providerId) === credentialId)
      .map(item => item.providerId)
    setStatus(prev => Object.assign({}, prev, ...affectedProviderIds.map(id => ({ [id]: configured }))))
    setKeys(prev => Object.assign({}, prev, ...affectedProviderIds.map(id => ({ [id]: apiKey }))))
  }

  const updateKey = (providerId: string, value: string): void => {
    setKeys(prev => ({ ...prev, [providerId]: value }))
    const existingTimer = timersRef.current[providerId]
    if (existingTimer) clearTimeout(existingTimer)
    timersRef.current[providerId] = setTimeout(() => {
      void (async () => {
        try {
          const trimmed = value.trim()
          const provider = config.providers.find(item => item.providerId === providerId)
          if (!provider) throw new Error(`Provider "${providerId}" is no longer available; reload settings and retry`)
          await llmConfigService.commitProviderSettings(
            provider,
            [],
            trimmed ? { kind: 'set', apiKey: trimmed } : { kind: 'remove' }
          )
          await refreshProviderKey(providerId)
        } catch (error) {
          logger.error(`[useLlmSettings] update key failed: ${providerId}`, error)
        }
      })()
    }, WRITE_DEBOUNCE_MS)
  }

  const toggleVisibility = (providerId: string): void => {
    setVisibility(prev => ({ ...prev, [providerId]: !prev[providerId] }))
  }

  const saveConfig = async (nextConfig: LlmConfigState): Promise<void> => {
    await llmConfigService.saveConfig(nextConfig)
    setConfig(nextConfig)
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

  return { config, keys, visibility, status, loading, updateKey, toggleVisibility, saveConfig }
}
