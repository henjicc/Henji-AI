import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getI18nText, type ParamDef, type ParamPresentationGroup } from '@/core/types'
import { resolveParamPresentationSections } from '@/core/params/paramPresentation'
import { LinkageEngine } from '@/core/linkage'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiGroup } from '@/components/ui'
import { ParamRenderer } from './ParamRenderer'
import { isParamDisabled } from './paramVisibility'

interface ParamGroupTriggerProps {
  group: ParamPresentationGroup
  params: ParamDef[]
  values: DynamicValueMap
  onChange: (paramId: string, value: DynamicValue) => void
  onChanges?: (changes: DynamicValueMap) => void
  linkageEngine: LinkageEngine | null
  uploadedImages?: string[]
  uploadedVideos?: string[]
  disabledParamIds?: ReadonlySet<string>
  compact?: boolean
}

function isSameValue(value: DynamicValue, defaultValue: DynamicValue): boolean {
  if (Object.is(value, defaultValue)) return true
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null || typeof defaultValue !== 'object' || defaultValue === null) {
    return false
  }
  return JSON.stringify(value) === JSON.stringify(defaultValue)
}

export function ParamGroupTrigger({
  group,
  params,
  values,
  onChange,
  onChanges,
  linkageEngine,
  uploadedImages = [],
  uploadedVideos = [],
  disabledParamIds,
  compact = false,
}: ParamGroupTriggerProps): JSX.Element {
  const { i18n } = useTranslation()
  const sections = useMemo(
    () => resolveParamPresentationSections(group, params),
    [group, params]
  )
  const changedCount = params.reduce((count, param) => (
    isSameValue(values[param.id], param.default) ? count : count + 1
  ), 0)
  const groupName = getI18nText(group.name, i18n.language) || group.id
  const summary = changedCount > 0
    ? (i18n.language.startsWith('zh') ? `已调整 ${changedCount} 项` : `${changedCount} changed`)
    : (i18n.language.startsWith('zh') ? '默认' : 'Default')

  return (
    <div data-param-group-id={group.id} className="contents">
      <PanelTrigger
        label={compact ? undefined : groupName}
        display={summary}
        className={compact ? 'min-w-0' : 'w-auto min-w-[108px]'}
        buttonClassName={compact
          ? '!h-7 !w-auto !max-w-[116px] !justify-between !gap-1.5 !rounded-md !px-2 !py-0 !text-xs !font-normal'
          : 'w-auto min-w-[108px]'}
        buttonLabelClassName="text-xs"
        panelWidth={group.panelWidth ?? 440}
        alignment="aboveCenter"
        gap={compact ? 8 : 45}
        freezePositionOnOpen
        closeOnPanelClick={false}
        renderPanel={() => (
        <div className="p-3">
          {sections.map(({ section, params: sectionParams }, index) => (
            <UiGroup
              key={section.id}
              title={getI18nText(section.name, i18n.language) || section.id}
              divided={index > 0}
              gap="none"
              className={index > 0 ? 'mt-4' : ''}
            >
              <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
                {sectionParams.map((param) => (
                  <div
                    key={param.id}
                    className={param.type === 'text' || param.type === 'textarea'
                      ? 'min-w-[180px] flex-1'
                      : ''}
                  >
                    <ParamRenderer
                      param={param}
                      value={values[param.id]}
                      onChange={(value) => onChange(param.id, value)}
                      allValues={values}
                      uploadedImages={uploadedImages}
                      uploadedVideos={uploadedVideos}
                      onParamChange={onChange}
                      onParamChanges={onChanges}
                      disabled={disabledParamIds?.has(param.id) === true || isParamDisabled(param, values, linkageEngine)}
                    />
                  </div>
                ))}
              </div>
            </UiGroup>
          ))}
        </div>
        )}
      />
    </div>
  )
}
