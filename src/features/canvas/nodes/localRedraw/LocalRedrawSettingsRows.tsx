import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ParamLabel } from '@/components/params/ParamLabel'
import type { ParamDef } from '@/core/types'
import { createCanvasTextHistoryGroup } from '@/features/canvas/hooks/useCanvasTextHistory'
import { NodeParamControl } from '@/features/canvas/params/NodeParamControl'
import {
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_LABEL_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import type { LocalRedrawSettings } from '@/platform/contracts/image'

const LOCAL_REDRAW_SETTINGS_SCHEMA: ParamDef[] = [
  {
    id: 'contextScale',
    type: 'number',
    order: 1,
    name: { zh: '上下文范围', en: 'Context range' },
    tooltip: {
      zh: '按遮罩外接矩形向外扩展的倍数。范围越大，模型和对齐算法可参考的上下文越多。',
      en: 'Expansion around the mask bounds. Larger values preserve more context for generation and alignment.',
    },
    default: 2,
    min: 1,
    max: 5,
    step: 0.25,
  },
  {
    id: 'aspectRatio',
    type: 'dropdown',
    order: 2,
    name: { zh: '裁剪比例', en: 'Crop ratio' },
    tooltip: {
      zh: '智能会匹配当前模型真实支持且最接近选区的比例，避免模型输出被拉伸后再贴回。',
      en: 'Smart matches the closest ratio actually supported by the selected model to avoid stretching.',
    },
    default: 'auto',
    options: [
      { value: 'auto', label: { zh: '智能匹配', en: 'Smart match' } },
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
    ],
  },
  {
    id: 'registrationQuality',
    type: 'dropdown',
    order: 3,
    name: { zh: '对齐精度', en: 'Alignment quality' },
    tooltip: {
      zh: '快速、精细、极致对应逐级增加的采样、特征和亚像素细化预算。',
      en: 'Fast, precise, and extreme progressively increase sampling, feature, and subpixel refinement budgets.',
    },
    default: 'precise',
    options: [
      { value: 'fast', label: { zh: '快速', en: 'Fast' } },
      { value: 'precise', label: { zh: '精细', en: 'Precise' } },
      { value: 'extreme', label: { zh: '极致', en: 'Extreme' } },
    ],
  },
  {
    id: 'featherPixels',
    type: 'number',
    order: 4,
    name: { zh: '遮罩羽化', en: 'Mask feather' },
    tooltip: {
      zh: '对用户绘制的黑白遮罩边缘做柔化，减少矩形裁剪结果贴回时的接缝。',
      en: 'Softens the user mask boundary to reduce seams when the rectangular crop is pasted back.',
    },
    default: 12,
    min: 0,
    max: 128,
    step: 1,
    unit: 'px',
  },
  {
    id: 'forceRegistration',
    type: 'switch',
    order: 5,
    name: { zh: '强制对齐', en: 'Force alignment' },
    tooltip: {
      zh: '允许使用未达到普通置信度门槛的对齐结果；越界、选区覆盖不足等硬性安全检查仍不会被绕过。',
      en: 'Allows alignment below normal confidence thresholds; hard geometry and coverage checks still apply.',
    },
    default: false,
  },
]

interface LocalRedrawSettingsRowsProps {
  nodeId: string
  settings: LocalRedrawSettings
  onChange: (settings: LocalRedrawSettings) => void
}

export function LocalRedrawSettingsRows({
  nodeId,
  settings,
  onChange,
}: LocalRedrawSettingsRowsProps) {
  const { i18n } = useTranslation()
  const values = useMemo<DynamicValueMap>(() => ({ ...settings }), [settings])

  return (
    <>
      {LOCAL_REDRAW_SETTINGS_SCHEMA.map((param) => (
        <div key={param.id} className={NODE_ROW_CLASS} data-local-redraw-setting={param.id}>
          <ParamLabel
            param={param}
            language={i18n.language}
            className={`${NODE_ROW_LABEL_CLASS} !mb-0`}
          />
          <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
            <NodeParamControl
              param={param}
              value={values[param.id]}
              allValues={values}
              onChange={(value) => {
                onChange({ ...settings, [param.id]: value } as LocalRedrawSettings)
              }}
              onParamChange={(paramId, value) => {
                onChange({ ...settings, [paramId]: value } as LocalRedrawSettings)
              }}
              onParamChanges={(changes) => {
                onChange({ ...settings, ...changes } as LocalRedrawSettings)
              }}
              historyGroup={createCanvasTextHistoryGroup(nodeId, `localRedrawSettings.${param.id}`)}
            />
          </div>
        </div>
      ))}
    </>
  )
}
