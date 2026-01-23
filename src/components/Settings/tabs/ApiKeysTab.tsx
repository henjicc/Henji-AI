import React from 'react'
import { useApiKeys } from '../hooks/useApiKeys'
import ApiKeyInput from '../components/ApiKeyInput'

const API_KEY_CONFIGS = [
  { provider: 'ppio', label: 'PPIO API Key', placeholder: '请输入 PPIO API Key' },
  { provider: 'fal', label: 'Fal.ai API Key', placeholder: '请输入 Fal.ai API Key' },
  { provider: 'modelscope', label: 'ModelScope API Key', placeholder: '请输入 ModelScope API Key' },
  { provider: 'kie', label: 'KIE API Key', placeholder: '请输入 KIE API Key' },
  { provider: 'bizyair', label: 'BizyAir API Key', placeholder: '请输入 BizyAir API Key' }
]

const ApiKeysTab: React.FC = () => {
  const { keys, visibility, updateKey, toggleVisibility } = useApiKeys()

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">API 密钥设置</h3>
      <p className="text-sm text-zinc-400 mb-6">
        配置各个服务提供商的 API 密钥。密钥将安全地存储在本地。
      </p>

      <div className="space-y-4">
        {API_KEY_CONFIGS.map(config => (
          <ApiKeyInput
            key={config.provider}
            provider={config.provider}
            label={config.label}
            value={keys[config.provider as keyof typeof keys]}
            visible={visibility[config.provider] || false}
            onChange={(value) => updateKey(config.provider as any, value)}
            onToggleVisibility={() => toggleVisibility(config.provider)}
            placeholder={config.placeholder}
          />
        ))}
      </div>
    </div>
  )
}

export default ApiKeysTab
