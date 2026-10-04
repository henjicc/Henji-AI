import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getI18nText, type ParamDef, type ParamPresentationGroup } from '@/core/types'
import { resolveParamPresentationSections } from '@/core/params/paramPresentation'
import { LinkageEngine } from '@/core/linkage'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiGroup } from '@/components/ui'
import { ParamRenderer } from './ParamRenderer'
import { countChangedParams, isParamDisabled } from './paramVisibility'

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



interface ParamGroupSectionsProps {
  group: ParamPresentationGroup
  params: ParamDef[]
  values: DynamicValueMap
  onChange: (paramId: string, value: DynamicValue) => void
  onChanges?: (changes: DynamicValueMap) => void
  linkageEngine: LinkageEngine | null
  uploadedImages?: string[]
  uploadedVideos?: string[]
  disabledParamIds?: ReadonlySet<string>
  /** 分节标题档：参数组浮层里是区块标题；嵌在“更多参数”的分组标题下时用 compact，避免层级倒挂 */
  sectionTitleTone?: 'section' | 'compact'
}

/**
 * 展示分组的分节内容（表单排布）。参数组浮层与生成底栏“更多参数”浮层共用：
 * 后者把收起的展示分组直接展开为分节，不再嵌一层参数组触发器（任务 4.3）。
 */
export function ParamGroupSections({
  group,
  params,
  values,
  onChange,
  onChanges,
  linkageEngine,
  uploadedImages = [],
  uploadedVideos = [],
  disabledParamIds,
  sectionTitleTone = 'section',
}: ParamGroupSectionsProps): JSX.Element {
  const { i18n } = useTranslation()
  const sections = useMemo(
    () => resolveParamPresentationSections(group, params),
    [group, params]
  )
  return (
    <>
      {sections.map(({ section, params: sectionParams }, index) => (
        <UiGroup
          key={section.id}
          title={getI18nText(section.name, i18n.language) || section.id}
          titleTone={sectionTitleTone}
          divided={index > 0}
          gap="none"
          className={index > 0 ? 'mt-4' : ''}
        >
          {/* 表单排布标签在上：按顶端对齐，控件高度不一（上传格、数值框、分段）时标签仍在同一行 */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
            {sectionParams.map((param) => (
              <div
                key={param.id}
                data-param-id={param.id}
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
    </>
  )
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
  const changedCount = countChangedParams(params, values)
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
        size={compact ? 'sm' : 'md'}
        surface={compact ? 'glass' : 'solid'}
        buttonClassName={compact ? 'w-auto max-w-[116px]' : 'w-auto min-w-[108px]'}
        panelWidth={group.panelWidth ?? 440}
        alignment="aboveCenter"
        gap={compact ? 8 : 45}
        freezePositionOnOpen
        closeOnPanelClick={false}
        renderPanel={() => (
          <div className="p-3">
            <ParamGroupSections
              group={group}
              params={params}
              values={values}
              onChange={onChange}
              onChanges={onChanges}
              linkageEngine={linkageEngine}
              uploadedImages={uploadedImages}
              uploadedVideos={uploadedVideos}
              disabledParamIds={disabledParamIds}
            />
          </div>
        )}
      />
    </div>
  )
}
