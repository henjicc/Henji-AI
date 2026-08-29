import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ParamLabel } from '@/components/params/ParamLabel'
import type { ParamDef } from '@/core/types'
import type { PortraitTextureSettingsV1 } from '@/features/canvas/capabilities'
import { createCanvasTextHistoryGroup } from '@/features/canvas/hooks/useCanvasTextHistory'
import { NodeParamControl } from '@/features/canvas/params/NodeParamControl'
import {
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_LABEL_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'

const SETTINGS_SCHEMA: ParamDef[] = [
  {
    id: 'portraitTexturePreset',
    type: 'dropdown',
    order: 1,
    name: { zh: '质感预设', en: 'Finish preset' },
    tooltip: { zh: '预设会转换为隐藏提示词，由模型近似执行。', en: 'The preset is compiled into a hidden prompt and approximated by the model.' },
    default: 'natural-detail',
    options: [
      { value: 'natural-detail', label: { zh: '自然细节', en: 'Natural detail' } },
      { value: 'commercial-clean', label: { zh: '商业净透', en: 'Commercial clean' } },
      { value: 'film-soft', label: { zh: '柔和胶片', en: 'Soft film' } },
      { value: 'cinematic-depth', label: { zh: '电影层次', en: 'Cinematic depth' } },
    ],
  },
  {
    id: 'portraitTextureStrength',
    type: 'dropdown',
    order: 2,
    name: { zh: '处理强度', en: 'Edit strength' },
    tooltip: { zh: '仅提供保守档位，不代表可精确量化的修图强度。', en: 'Only conservative model-approximate levels are provided.' },
    default: 'subtle',
    options: [
      { value: 'subtle', label: { zh: '轻微', en: 'Subtle' } },
      { value: 'balanced', label: { zh: '适中', en: 'Balanced' } },
    ],
  },
  {
    id: 'portraitTextureUserPrompt',
    type: 'text',
    order: 3,
    name: { zh: '补充要求', en: 'Additional request' },
    tooltip: { zh: '补充要求不能覆盖身份、五官、构图和敏感属性保护约束。', en: 'Additional text cannot override identity, composition, or sensitive-attribute safeguards.' },
    default: '',
    maxLength: 8_000,
    placeholder: { zh: '例如：保留雀斑与自然肤质', en: 'For example: keep freckles and natural skin texture' },
    editor: { kind: 'prompt', preset: 'plain' },
  },
]

interface PortraitTextureSettingsRowsProps {
  nodeId: string
  settings: PortraitTextureSettingsV1
  onSettingChange: (key: string, value: DynamicValue) => void
  onSettingsChange: (changes: DynamicValueMap) => void
}

export function PortraitTextureSettingsRows({
  nodeId,
  settings,
  onSettingChange,
  onSettingsChange,
}: PortraitTextureSettingsRowsProps) {
  const { i18n, t } = useTranslation()
  const values = useMemo<DynamicValueMap>(() => ({
    portraitTexturePreset: settings.preset,
    portraitTextureStrength: settings.strength,
    portraitTextureUserPrompt: settings.userPrompt,
  }), [settings])

  return (
    <>
      {SETTINGS_SCHEMA.map((param) => (
        <div key={param.id} className={NODE_ROW_CLASS}>
          <ParamLabel param={param} language={i18n.language} className={`${NODE_ROW_LABEL_CLASS} !mb-0`} />
          <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
            <NodeParamControl
              param={param}
              value={values[param.id]}
              onChange={(value) => onSettingChange(param.id, value)}
              allValues={values}
              onParamChange={onSettingChange}
              onParamChanges={onSettingsChange}
              historyGroup={createCanvasTextHistoryGroup(nodeId, `portraitTextureSettings.${param.id}`)}
            />
          </div>
        </div>
      ))}
      <p className="px-1 text-2xs text-text-muted">
        {t('node.portraitTextureGeneration.approximation')}
      </p>
    </>
  )
}
