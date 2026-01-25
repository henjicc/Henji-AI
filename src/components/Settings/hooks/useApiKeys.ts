import { useEffect, useState } from 'react'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'

type ApiKeys = Record<ApiKeyProvider, string>
type ApiKeyVisibility = Record<ApiKeyProvider, boolean>

export interface UseApiKeysResult {
  keys: ApiKeys
  visibility: ApiKeyVisibility
  updateKey: (provider: ApiKeyProvider, value: string) => void
  toggleVisibility: (provider: ApiKeyProvider) => void
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

  useEffect(() => {
    const loadedKeys = createEmptyKeys()
    API_KEY_PROVIDERS.forEach(provider => {
      loadedKeys[provider.id] = localStorage.getItem(`${provider.id}_api_key`) || ''
    })
    setKeys(loadedKeys)
  }, [])

  const updateKey = (provider: ApiKeyProvider, value: string) => {
    setKeys(prev => ({ ...prev, [provider]: value }))
    localStorage.setItem(`${provider}_api_key`, value)
  }

  const toggleVisibility = (provider: ApiKeyProvider) => {
    setVisibility(prev => ({ ...prev, [provider]: !prev[provider] }))
  }

  return { keys, visibility, updateKey, toggleVisibility }
}
