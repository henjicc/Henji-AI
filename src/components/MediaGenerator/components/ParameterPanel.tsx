/**
 * ParameterPanel - 生成参数面板
 *
 * 基于 ModelRegistry 与 ParamRenderer 按模型 schema 渲染参数；顺序见 `resolveParameterPanelLayout`。
 * 工具条排布（生成底栏）下是一行：放不下的参数按优先级收进行末“更多参数”浮层（任务 4.3）。
 */

import React, { useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { registry } from '@/core/ModelRegistry'
import { getI18nText, type ParamDef } from '@/core/types'
import { LinkageEngine } from '@/core/linkage'
import { ParamRenderer } from '@/components/params/ParamRenderer'
import {
  countChangedParams,
  findMissingRequiredParams,
  isParamDisabled,
  isParamVisible,
} from '@/components/params/paramVisibility'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { ParamGroupSections, ParamGroupTrigger } from '@/components/params/ParamGroupTrigger'
import { UiFieldTrigger, UiGroup, UiOverflowRow, useUiFieldLayout, type UiOverflowRowItem } from '@/components/ui'
import PanelTrigger, { type PanelTriggerControls } from '@/components/ui/PanelTrigger'
import Tooltip from '@/components/ui/Tooltip'
import AspectResolutionPanel from './AspectResolutionPanel'
import { isToolbarBlockParam, resolveParameterPanelLayout, resolveToolbarParamPriority, TOOLBAR_OVERFLOW_PRIORITY as PRIORITY } from './parameterOrder'

/** 生成前定位参数用的控制句柄（MediaGenerator 点生成时调用）。 */
export interface ParameterPanelController {
  /** 有必填未填的可见参数时打开所在浮层并聚焦，返回 true；没有则返回 false。 */
  revealFirstMissingRequired: () => boolean
}

interface ParameterPanelProps {
  currentModel: DynamicValue
  selectedModel: string
  uploadedImages: string[]
  uploadedVideos: string[]
  values: DynamicValueMap
  onChange: (id: string, value: DynamicValue) => void
  onChanges: (changes: DynamicValueMap) => void
  /** 工具条排布下排在最前、永不收起的项（生成底栏的模型选择） */
  toolbarLeading?: React.ReactNode
  controllerRef?: React.Ref<ParameterPanelController>
}

const SPECIAL_PANEL_ITEM_ID = 'special:aspect-resolution'
const LEADING_ITEM_ID = 'leading'

type OverflowEntry =
  | { id: string; kind: 'param'; param: ParamDef }
  | { id: string; kind: 'special' }
  | { id: string; kind: 'group'; item: Extract<ReturnType<typeof resolveParameterPanelLayout>['items'][number], { kind: 'group' }> }

/**
 * “更多参数”浮层宽度：含展示分组时按分组声明的宽度，含大块控件（多行文本、上传等）时 440；
 * 只有零散参数时按内容（列网格的自然宽度），不再固定 360 留出大片空白（任务 5.3）。
 */
function resolveMorePanelWidth(entries: OverflowEntry[]): number | 'content' {
  const groupWidths = entries.flatMap((entry) => entry.kind === 'group' ? [entry.item.group.panelWidth ?? 440] : [])
  const hasBlock = entries.some((entry) => entry.kind === 'param' && isToolbarBlockParam(entry.param))
  if (groupWidths.length > 0) return Math.max(...groupWidths)
  return hasBlock ? 440 : 'content'
}

/** 零散参数的列数：≤3 项一行排完，4 项两两成行，更多时三列，列宽按每列最宽项对齐。 */
function resolveMorePanelColumns(simpleCount: number): number {
  if (simpleCount <= 3) return Math.max(1, simpleCount)
  return simpleCount === 4 ? 2 : 3
}

const MORE_PANEL_GRID_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-[repeat(2,auto)]',
  3: 'grid-cols-[repeat(3,auto)]',
}

function focusFirstControl(root: ParentNode | null | undefined, paramId: string): void {
  // 不用 CSS.escape（jsdom 等环境没有）：按属性逐个比对
  const container = Array.from(root?.querySelectorAll<HTMLElement>('[data-param-id]') ?? [])
    .find((element) => element.getAttribute('data-param-id') === paramId)
  const target = container?.querySelector<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
  )
  ;(target ?? container)?.focus()
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  selectedModel,
  uploadedImages,
  uploadedVideos,
  values,
  onChange,
  onChanges,
  toolbarLeading,
  controllerRef,
}) => {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const toolbarLayout = useUiFieldLayout() === 'toolbar'
  const modelDef = registry.getModel(selectedModel)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const moreControlsRef = useRef<PanelTriggerControls | null>(null)
  const hiddenIdsRef = useRef<readonly string[]>([])

  const params = useMemo(() => {
    if (!modelDef) return []
    return [...registry.getSchema(selectedModel)].sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER
      return orderA - orderB
    })
  }, [modelDef, selectedModel])

  const linkageEngine = useMemo(() => {
    if (!modelDef?.linkages || modelDef.linkages.length === 0) return null
    return new LinkageEngine(modelDef.linkages)
  }, [modelDef?.linkages])

  const runtimeValues = useMemo(
    () => ({ ...values, uploadedImages, uploadedVideos }),
    [uploadedImages, uploadedVideos, values]
  )

  const visibleParams = useMemo(
    () => params.filter((param) => isParamVisible(param, runtimeValues, linkageEngine)),
    [linkageEngine, params, runtimeValues]
  )

  const filteredParams = useMemo(() => {
    if (!linkageEngine) return visibleParams
    return visibleParams.map((param): ParamDef => {
      if (param.type !== 'dropdown' && param.type !== 'radio') return param
      const options = linkageEngine.getFilteredOptions(param.id, runtimeValues, params)
      if (!options.length || options === param.options) return param
      return { ...param, options } as ParamDef
    })
  }, [linkageEngine, params, runtimeValues, visibleParams])

  const specialPanelSpec = useMemo(() => {
    if (!modelDef || modelDef.meta.provider === 'modelscope') return null
    return analyzeRatioResolutionParams(filteredParams, uploadedImages)
  }, [modelDef, filteredParams, uploadedImages])

  const layout = useMemo(() => {
    const consumed = new Set(specialPanelSpec?.consumedParamIds || [])
    return resolveParameterPanelLayout(
      filteredParams.filter((param) => !consumed.has(param.id)),
      modelDef?.paramPresentation,
      Boolean(specialPanelSpec),
    )
  }, [filteredParams, modelDef?.paramPresentation, specialPanelSpec])

  const missingRequired = useMemo(
    () => findMissingRequiredParams(params, runtimeValues, linkageEngine),
    [linkageEngine, params, runtimeValues]
  )

  const renderParam = useCallback((param: ParamDef) => (
    <ParamRenderer
      param={param}
      value={values[param.id]}
      onChange={(value) => onChange(param.id, value)}
      allValues={runtimeValues}
      uploadedImages={uploadedImages}
      uploadedVideos={uploadedVideos}
      onParamChange={onChange}
      onParamChanges={onChanges}
      disabled={isParamDisabled(param, runtimeValues, linkageEngine)}
    />
  ), [linkageEngine, onChange, onChanges, runtimeValues, uploadedImages, uploadedVideos, values])

  const specialPanel = specialPanelSpec ? (
    <AspectResolutionPanel
      aspectParam={specialPanelSpec.aspectParam}
      resolutionParam={specialPanelSpec.resolutionParam}
      values={values}
      uploadedImages={uploadedImages}
      onChange={onChange}
    />
  ) : null

  // 工具条排布：行内项 + 固定收纳进“更多参数”的大块控件
  const { rowItems, overflowEntries, panelOnlyIds } = useMemo(() => {
    const row: Array<Omit<UiOverflowRowItem, 'node'> & { entry: OverflowEntry | null }> = []
    const entries: OverflowEntry[] = []
    const panelOnly: string[] = []
    if (toolbarLeading !== undefined) row.push({ id: LEADING_ITEM_ID, priority: PRIORITY.leading, pinned: true, entry: null })
    for (const param of layout.primary) {
      const entry: OverflowEntry = { id: `param:${param.id}`, kind: 'param', param }
      entries.push(entry)
      row.push({ id: entry.id, priority: PRIORITY.primary, pinned: true, entry })
    }
    if (layout.hasSpecialPanel) {
      const entry: OverflowEntry = { id: SPECIAL_PANEL_ITEM_ID, kind: 'special' }
      entries.push(entry)
      row.push({ id: entry.id, priority: PRIORITY.special, entry })
    }
    layout.items.forEach((item) => {
      if (item.kind === 'param') {
        const entry: OverflowEntry = { id: `param:${item.param.id}`, kind: 'param', param: item.param }
        entries.push(entry)
        if (isToolbarBlockParam(item.param)) panelOnly.push(entry.id)
        else row.push({ id: entry.id, priority: resolveToolbarParamPriority(item.param), entry })
        return
      }
      const entry: OverflowEntry = { id: `group:${item.group.id}`, kind: 'group', item }
      entries.push(entry)
      row.push({ id: entry.id, priority: PRIORITY.group, entry })
    })
    return { rowItems: row, overflowEntries: entries, panelOnlyIds: panelOnly }
  }, [layout, toolbarLeading])

  const entryParams = useCallback((entry: OverflowEntry): ParamDef[] => {
    if (entry.kind === 'param') return [entry.param]
    if (entry.kind === 'group') return entry.item.params
    return [specialPanelSpec?.aspectParam, specialPanelSpec?.resolutionParam]
      .flatMap((descriptor) => descriptor ? params.filter((param) => param.id === descriptor.id) : [])
  }, [params, specialPanelSpec])

  const collapsedEntries = useCallback((hiddenIds: readonly string[]): OverflowEntry[] => {
    const collapsed = new Set([...hiddenIds, ...panelOnlyIds])
    return overflowEntries.filter((entry) => collapsed.has(entry.id))
  }, [overflowEntries, panelOnlyIds])

  const renderOverflowPanel = (entries: OverflowEntry[]): React.ReactNode => {
    // 表单排布：零散参数按列网格对齐（列宽取该列最宽项），大块控件与展示分组独占一行
    const simpleCount = entries.filter((entry) => entry.kind === 'special' || (entry.kind === 'param' && !isToolbarBlockParam(entry.param))).length
    const columns = resolveMorePanelColumns(simpleCount)
    return (
    <div className={`grid ${MORE_PANEL_GRID_CLASS[columns]} items-start justify-start gap-x-6 gap-y-3 p-3`}>
      {entries.map((entry, index) => {
        if (entry.kind === 'param') {
          return (
            <div
              key={entry.id}
              data-param-id={entry.param.id}
              className={isToolbarBlockParam(entry.param) ? 'col-span-full' : 'min-w-0'}
            >
              {renderParam(entry.param)}
            </div>
          )
        }
        if (entry.kind === 'special') return <div key={entry.id}>{specialPanel}</div>
        return (
          // 收起的展示分组保留分组名（如“MJ 设置”）作标题，分节直接展开，不再嵌一层参数组触发器
          <UiGroup
            key={entry.id}
            data-param-group-id={entry.item.group.id}
            title={getI18nText(entry.item.group.name, i18n.language) || entry.item.group.id}
            divided={index > 0}
            gap="none"
            className="col-span-full"
          >
            <ParamGroupSections
              group={entry.item.group}
              params={entry.item.params}
              values={runtimeValues}
              onChange={onChange}
              onChanges={onChanges}
              linkageEngine={linkageEngine}
              uploadedImages={uploadedImages}
              uploadedVideos={uploadedVideos}
              sectionTitleTone="compact"
            />
          </UiGroup>
        )
      })}
    </div>
    )
  }

  const renderMoreTrigger = (hiddenIds: readonly string[]): React.ReactNode => {
    hiddenIdsRef.current = hiddenIds
    const entries = collapsedEntries(hiddenIds)
    const collapsedParams = entries.flatMap(entryParams)
    const collapsedIds = new Set(collapsedParams.map((param) => param.id))
    const missingCount = missingRequired.filter((param) => collapsedIds.has(param.id)).length
    const changedCount = countChangedParams(collapsedParams, runtimeValues)
    const label = zh ? '更多参数' : 'More'
    const status = missingCount > 0
      ? (zh ? '需填写' : 'Required')
      : changedCount > 0
        ? (zh ? `已调整 ${changedCount}` : `${changedCount} changed`)
        : String(entries.length)
    const names = collapsedParams.map((param) => getI18nText(param.name, i18n.language)).filter(Boolean)
    return (
      <PanelTrigger
        controlsRef={moreControlsRef}
        panelWidth={resolveMorePanelWidth(entries)}
        alignment="aboveCenter"
        closeOnPanelClick={false}
        renderPanel={() => renderOverflowPanel(entries)}
      >
        {({ open, togglePanel }) => {
          const trigger = (
          <UiFieldTrigger
            appearance="quiet"
            open={open}
            onClick={togglePanel}
            data-panel-trigger-button
            data-more-params-trigger
            data-missing-required={missingCount > 0 ? 'true' : undefined}
            aria-expanded={open}
            aria-label={`${label}：${status}`}
          >
            <span className="text-text2">{label}</span>
            {/* 必填未填用状态色（警示文字令牌），不用图标或 emoji */}
            <span className={`ml-1.5 ${missingCount > 0 ? 'text-warning-text' : 'text-text3'}`}>{status}</span>
          </UiFieldTrigger>
          )
          // 悬停提示列出被收起的参数名；包裹结构保持稳定，避免开合时触发器重新挂载
          // 浮层打开时不再提示（hidden 只隐藏提示框，包裹结构不变）
          return names.length > 0
            ? <Tooltip content={names.join(zh ? '、' : ', ')} className={open ? 'hidden' : undefined}>{trigger}</Tooltip>
            : trigger
        }}
      </PanelTrigger>
    )
  }

  useImperativeHandle(controllerRef, () => ({
    revealFirstMissingRequired: () => {
      const missing = missingRequired[0]
      if (!missing) return false
      const collapsed = collapsedEntries(hiddenIdsRef.current)
      const inPanel = collapsed.some((entry) => entryParams(entry).some((param) => param.id === missing.id))
      if (inPanel && moreControlsRef.current) {
        const controls = moreControlsRef.current
        if (!controls.open) controls.openPanel()
        // 浮层挂载与定位需要一帧
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusFirstControl(document, missing.id)))
        return true
      }
      focusFirstControl(rowRef.current, missing.id)
      return true
    },
  }), [collapsedEntries, entryParams, missingRequired])

  if (!modelDef || params.length === 0) {
    if (!toolbarLayout || toolbarLeading === undefined) return null
    return (
      <div ref={rowRef} className="flex min-w-0 flex-1">
        <UiOverflowRow className="flex-1 gap-x-3" items={[{ id: LEADING_ITEM_ID, priority: PRIORITY.leading, pinned: true, node: toolbarLeading }]} renderOverflow={() => null} />
      </div>
    )
  }

  if (toolbarLayout) {
    const items: UiOverflowRowItem[] = rowItems.map(({ entry, ...item }) => ({
      ...item,
      node: entry === null
        ? toolbarLeading
        : entry.kind === 'param'
          ? <div data-param-id={entry.param.id} className="contents">{renderParam(entry.param)}</div>
          : entry.kind === 'special'
            ? specialPanel
            : (
              <ParamGroupTrigger
                group={entry.item.group}
                params={entry.item.params}
                values={runtimeValues}
                onChange={onChange}
                onChanges={onChanges}
                linkageEngine={linkageEngine}
                uploadedImages={uploadedImages}
                uploadedVideos={uploadedVideos}
              />
            ),
    }))
    return (
      <div ref={rowRef} className="flex min-w-0 flex-1">
        <UiOverflowRow
          className="flex-1 gap-x-3"
          items={items}
          alwaysShowOverflow={panelOnlyIds.length > 0}
          renderOverflow={renderMoreTrigger}
        />
      </div>
    )
  }

  // 表单排布：渠道最优先，其次是模式/版本/变体；分辨率/比例面板保持其余参数前置
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {layout.primary.map((param) => <React.Fragment key={param.id}>{renderParam(param)}</React.Fragment>)}
      {specialPanel}
      {layout.items.map((item) => item.kind === 'param' ? (
        <React.Fragment key={item.param.id}>{renderParam(item.param)}</React.Fragment>
      ) : (
        <ParamGroupTrigger
          key={item.group.id}
          group={item.group}
          params={item.params}
          values={runtimeValues}
          onChange={onChange}
          onChanges={onChanges}
          linkageEngine={linkageEngine}
          uploadedImages={uploadedImages}
          uploadedVideos={uploadedVideos}
        />
      ))}
    </div>
  )
}

export default ParameterPanel
