import { useState, useEffect } from 'react'

interface ApiKeys {
  ppio: string
  fal: string
  modelscope: string
  kie: string
  bizyair: string
}

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKeys>({
    ppio: '',
    fal: '',
    modelscope: '',
    kie: '',
    bizyair: ''
  })

  const [visibility, setVisibility] = useState<Record<string, boolean>>({})

  // 加载 API Keys
  useEffect(() => {
    const providers = ['ppio', 'fal', 'modelscope', 'kie', 'bizyair'] as const
    const loadedKeys = {} as ApiKeys

    providers.forEach(provider => {
      loadedKeys[provider] = localStorage.getItem(`${provider}_api_key`) || ''
    })

    setKeys(loadedKeys)
  }, [])

  // 更新 API Key
  const updateKey = (provider: keyof ApiKeys, value: string) => {
    setKeys(prev => ({ ...prev, [provider]: value }))
    localStorage.setItem(`${provider}_api_key`, value)
  }

  // 切换可见性
  const toggleVisibility = (provider: string) => {
    setVisibility(prev => ({ ...prev, [provider]: !prev[provider] }))
  }

  return { keys, visibility, updateKey, toggleVisibility }
}
