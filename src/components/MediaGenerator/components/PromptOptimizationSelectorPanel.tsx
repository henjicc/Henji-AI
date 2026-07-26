import React from 'react'
import { Settings2, Sparkles } from 'lucide-react'
import { UiButton, UiOptionButton } from '@/components/ui'
import type { PromptOptimizationProfile } from '@/core/llm/types'

interface PromptOptimizationSelectorPanelProps {
  profiles: PromptOptimizationProfile[]
  selectedProfileId: string
  optimizing: boolean
  onSelectProfile: (profileId: string) => void
  onOpenEditor: () => void
}

export function PromptOptimizationSelectorPanel({
  profiles,
  selectedProfileId,
  optimizing,
  onSelectProfile,
  onOpenEditor,
}: PromptOptimizationSelectorPanelProps): JSX.Element {
  return (
    <div className="flex max-h-[min(560px,calc(100vh-96px))] flex-col p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-text-dark">选择提示词优化配置</div>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpenEditor}
          className="shrink-0"
        >
          <Settings2 size={14} className="mr-2" />
          编辑配置
        </UiButton>
      </div>

      {profiles.length > 0 ? (
        <div className="space-y-2 overflow-y-auto pr-1">
          {profiles.map((profile) => (
            <UiOptionButton
              key={profile.id}
              type="button"
              active={profile.id === selectedProfileId}
              variant="menu"
              onClick={() => onSelectProfile(profile.id)}
              className="w-full justify-start gap-2 px-3 py-3 text-left"
              disabled={optimizing}
            >
              <Sparkles size={14} className="shrink-0" />
              <span className="truncate text-sm">{profile.name}</span>
            </UiOptionButton>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border-dark bg-app px-4 py-5 text-sm text-text-muted">
          还没有可用的优化配置，请先点击右上角编辑配置进行创建或启用。
        </div>
      )}
    </div>
  )
}
