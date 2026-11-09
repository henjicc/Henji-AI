import { UI_ICON_SIZE } from '@/core/theme/icons'
import React from 'react'
import { Settings2, Sparkles } from 'lucide-react'
import { UI_TEXT_PANEL_TITLE_CLASS, UiEmpty, UiIconButton, UiOptionButton } from '@/components/ui'
import type { PromptOptimizationProfile } from '@henjicc/ai-sdk'

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
    <div className="flex max-h-[min(560px,calc(100vh-96px))] flex-col p-2">
      <div className="mb-1 flex items-center justify-between gap-3 pl-2">
        <div className={UI_TEXT_PANEL_TITLE_CLASS}>选择提示词优化配置</div>
        <UiIconButton size="sm" label="编辑配置" tooltip="编辑配置" onClick={onOpenEditor} className="shrink-0">
          <Settings2 />
        </UiIconButton>
      </div>

      {profiles.length > 0 ? (
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {profiles.map((profile) => (
            <UiOptionButton
              key={profile.id}
              type="button"
              active={profile.id === selectedProfileId}
              variant="menu"
              onClick={() => onSelectProfile(profile.id)}
              className="w-full justify-start gap-2 text-left"
              disabled={optimizing}
            >
              <Sparkles size={UI_ICON_SIZE.sm} className="shrink-0" />
              <span className="truncate text-sm">{profile.name}</span>
            </UiOptionButton>
          ))}
        </div>
      ) : (
        <UiEmpty
          size="sm"
          title="还没有可用的优化配置"
          description="点右上角的设置图标创建或启用。"
        />
      )}
    </div>
  )
}
