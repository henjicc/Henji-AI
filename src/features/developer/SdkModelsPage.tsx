import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CircleCheck, CircleX, Copy, Play } from 'lucide-react'
import PriceEstimate from '@/components/ui/PriceEstimate'
import {
  UI_TEXT_META_CLASS,
  UI_TEXT_PANEL_TITLE_CLASS,
  UI_TEXT_SECONDARY_CLASS,
  UI_TEXT_TIMECODE_CLASS,
  UiButton,
  UiChipButton,
  UiEmpty,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiInlineStatus,
  UiNavButton,
  UiOptionButton,
  UiPanel,
  UiSearchInput,
  UiSwitch,
  UiToolbar,
  UiVirtualList,
} from '@/components/ui'
import { writeClipboardText } from '@/commands/clipboard'
import { llmGetProviderKeyStatus } from '@/commands/llmRuntime'
import { createLogger } from '@/core/logging'
import { llmConfigService } from '@/services/llm'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { openApplicationSurface } from '@/features/navigation/application/surfaceNavigationService'
import { dryRunGenerationModel, listSdkModels, sdkModelDefaults, sdkProviderName, SDK_MODEL_CATEGORIES, type SdkDryRunResult, type SdkModelCategory, type SdkModelRow } from './sdkModelInventory'

const CATEGORY_LABEL: Readonly<Record<SdkModelCategory, string>> = {
  image: '图片', video: '视频', audio: '音频', tool: '图片工具', llm: '大语言模型', asr: '语音识别', translation: '翻译',
}

// 自动化与助手核对用：面板打开后可以在开发控制台或测试脚本里直接调用同一份清单与离线检查。
if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
  Object.assign(window as unknown as Record<string, unknown>, { __henjiSdkModels: { list: listSdkModels, dryRun: dryRunGenerationModel } })
}

function providerName(providerId: string): string {
  return providerId ? sdkProviderName(providerId) : '未登记'
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—'
  return typeof value === 'string' ? value || '（空）' : JSON.stringify(value)
}

const logger = createLogger('SdkModelsPage')

/** 大语言模型的密钥按设置里的供应商凭据存，不在生成供应商的密钥表里。 */
function useLlmKeyStatus(): Readonly<Record<string, boolean>> {
  const [status, setStatus] = useState<Readonly<Record<string, boolean>>>({})
  useEffect(() => {
    let disposed = false
    void (async () => {
      const config = await llmConfigService.getConfig()
      const credentialOf = (provider: (typeof config.providers)[number]): string => provider.credentialId ?? provider.providerId
      const statuses = await llmGetProviderKeyStatus(config.providers.map(credentialOf))
      const configured = new Set(statuses.filter((item) => item.configured).map((item) => item.credentialId))
      if (!disposed) setStatus(Object.fromEntries(config.providers.map((provider) => [provider.providerId, configured.has(credentialOf(provider))])))
    })().catch((error: unknown) => logger.error('读取大语言模型密钥状态失败', error))
    return () => { disposed = true }
  }, [])
  return status
}

export const SdkModelsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const rows = useMemo(() => listSdkModels(), [])
  const keyStatus = useSettingsStore((state) => state.providerKeyStatus)
  const llmKeyStatus = useLlmKeyStatus()
  const isConfigured = (row: SdkModelRow): boolean => (row.llm ? llmKeyStatus : keyStatus)[row.providerId] === true
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<SdkModelCategory | null>(null)
  const [providers, setProviders] = useState<ReadonlySet<string>>(new Set())
  const [onlyConfigured, setOnlyConfigured] = useState(false)
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [checks, setChecks] = useState<ReadonlyMap<string, SdkDryRunResult>>(new Map())
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)

  const providerIds = useMemo(() => [...new Set(rows.map((row) => row.providerId).filter(Boolean))].sort(), [rows])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => (!category || row.category === category)
      && (!providers.size || providers.has(row.providerId))
      && (!onlyConfigured || (row.llm ? llmKeyStatus : keyStatus)[row.providerId] === true)
      && (!onlyFailed || checks.get(row.modelId)?.ok === false)
      && (!needle || `${row.name} ${row.modelId} ${row.providerId} ${providerName(row.providerId)} ${row.tags.join(' ')} ${row.rawTags.join(' ')}`.toLowerCase().includes(needle)))
  }, [rows, query, category, providers, onlyConfigured, onlyFailed, keyStatus, llmKeyStatus, checks])
  const selected = rows.find((row) => row.key === selectedKey) ?? null

  const toggleProvider = (providerId: string): void => setProviders((current) => {
    const next = new Set(current)
    if (next.has(providerId)) next.delete(providerId)
    else next.add(providerId)
    return next
  })
  const record = (modelId: string, result: SdkDryRunResult): void => setChecks((current) => new Map(current).set(modelId, result))

  const checkAll = async (): Promise<void> => {
    const targets = filtered.filter((row) => row.generation)
    setBatch({ done: 0, total: targets.length })
    for (const [index, row] of targets.entries()) {
      const result = await dryRunGenerationModel(row.modelId, undefined, { sample: true })
      if (!mounted.current) return
      record(row.modelId, result)
      setBatch({ done: index + 1, total: targets.length })
    }
    setBatch(null)
  }
  const copyList = (): void => {
    const lines = filtered.map((row) => [row.name, row.modelId, providerName(row.providerId), CATEGORY_LABEL[row.category], checkLabel(checks.get(row.modelId))].join('\t'))
    void writeClipboardText(lines.join('\n'))
  }
  const failedCount = [...checks.values()].filter((result) => !result.ok).length

  return (
    <>
      <UiToolbar
        variant="command"
        center={<UiSearchInput className="w-80" size="sm" placeholder="搜索名称、Model ID、供应商、能力" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />}
        trailing={<>
          <UiButton size="sm" loading={batch !== null} onClick={() => void checkAll()} tooltip="把当前筛选出的生成模型全部离线构建一次请求（补示例输入），不联网不扣费">
            <CircleCheck />{batch ? `检查中 ${batch.done}/${batch.total}` : '离线检查全部'}
          </UiButton>
          <UiIconButton tooltip="复制当前清单（制表符分隔）" aria-label="复制清单" onClick={copyList}><Copy /></UiIconButton>
        </>}
        barProps={{ 'data-sdk-models-count': filtered.length, 'data-sdk-models-failed': failedCount }}
      >
        <UiIconButton tooltip="返回工具" aria-label="返回工具" onClick={onBack}><ArrowLeft /></UiIconButton>
        <span className={UI_TEXT_PANEL_TITLE_CLASS}>SDK 模型</span>
        <span className={UI_TEXT_META_CLASS}>{filtered.length} / {rows.length}{failedCount ? ` · 检查失败 ${failedCount}` : ''}</span>
      </UiToolbar>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,24rem)]">
        <aside aria-label="筛选" className="flex min-h-0 flex-col gap-6 overflow-y-auto border-r border-line p-3">
          <UiGroup title="类别" titleTone="compact">
            <div className="flex flex-col">
              <UiNavButton size="md" active={category === null} onClick={() => setCategory(null)}>全部 · {rows.length}</UiNavButton>
              {SDK_MODEL_CATEGORIES.map((item) => (
                <UiNavButton key={item} size="md" active={category === item} onClick={() => setCategory(item)} data-sdk-category={item}>
                  {CATEGORY_LABEL[item]} · {rows.filter((row) => row.category === item).length}
                </UiNavButton>
              ))}
            </div>
          </UiGroup>
          <UiGroup title="供应商" titleTone="compact">
            <div className="flex flex-wrap gap-1.5">
              {providerIds.map((providerId) => (
                <UiChipButton key={providerId} size="sm" active={providers.has(providerId)} onClick={() => toggleProvider(providerId)} data-sdk-provider={providerId}>
                  {providerName(providerId)}
                </UiChipButton>
              ))}
            </div>
          </UiGroup>
          <UiGroup title="状态" titleTone="compact">
            <div className="flex flex-wrap gap-1.5">
              <UiChipButton size="sm" active={onlyConfigured} onClick={() => setOnlyConfigured((value) => !value)}>已配密钥</UiChipButton>
              <UiChipButton size="sm" active={onlyFailed} onClick={() => setOnlyFailed((value) => !value)}>检查失败</UiChipButton>
            </div>
          </UiGroup>
        </aside>
        <section aria-label="模型" className="flex min-h-0 flex-col">
          <div className={`grid grid-cols-[minmax(0,2fr)_6rem_5rem_minmax(0,1.4fr)_2rem] gap-3 border-b border-line px-5 py-2 ${UI_TEXT_META_CLASS}`}>
            <span>模型</span><span>供应商</span><span>类别</span><span>能力</span><span>检查</span>
          </div>
          <div className="min-h-0 flex-1">
            <UiVirtualList
              data={filtered}
              getKey={(row) => row.key}
              resetKey={`${query}|${category}|${[...providers].join(',')}|${onlyConfigured}|${onlyFailed}`}
              emptyState={<UiEmpty title="没有符合条件的模型" />}
              renderItem={(row) => (
                // 行内边距沿用菜单项自带的 px-3，外面再留 px-2，表头按两者之和对齐
                <div className="px-2">
                <UiOptionButton
                  variant="menu"
                  active={row.key === selectedKey}
                  data-sdk-model-row={row.key}
                  data-check-status={checkStatus(checks.get(row.modelId))}
                  className="grid min-h-11 w-full grid-cols-[minmax(0,2fr)_6rem_5rem_minmax(0,1.4fr)_2rem] items-center gap-3 text-left"
                  onClick={() => setSelectedKey(row.key)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{row.name}</span>
                    <span className={`truncate ${UI_TEXT_META_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.modelId}</span>
                  </span>
                  <span className={`truncate ${UI_TEXT_SECONDARY_CLASS}`}>{providerName(row.providerId)}</span>
                  <span className={`truncate ${UI_TEXT_SECONDARY_CLASS}`}>{CATEGORY_LABEL[row.category]}</span>
                  <span className={`truncate ${UI_TEXT_SECONDARY_CLASS}`}>{row.tags.join(' · ')}</span>
                  <CheckIcon result={checks.get(row.modelId)} />
                </UiOptionButton>
                </div>
              )}
            />
          </div>
        </section>
        <aside aria-label="模型详情" className="min-h-0 overflow-y-auto border-l border-line p-4">
          {selected
            ? <ModelDetail key={selected.key} row={selected} configured={isConfigured(selected)} result={checks.get(selected.modelId)} onResult={(result) => record(selected.modelId, result)} />
            : <UiEmpty title="选一个模型查看详情" />}
        </aside>
      </div>
    </>
  )
}

function checkStatus(result: SdkDryRunResult | undefined): string {
  return result ? (result.ok ? 'ok' : 'failed') : 'unchecked'
}
function checkLabel(result: SdkDryRunResult | undefined): string {
  return result ? (result.ok ? '通过' : `失败：${result.error ?? ''}`) : '未检查'
}

const CheckIcon: React.FC<{ result: SdkDryRunResult | undefined }> = ({ result }) => {
  if (!result) return <span className={UI_TEXT_META_CLASS}>—</span>
  return result.ok
    ? <CircleCheck aria-label="离线检查通过" className="h-4 w-4 text-success-text" />
    : <CircleX aria-label="离线检查失败" className="h-4 w-4 text-danger-text" />
}

const ModelDetail: React.FC<{ row: SdkModelRow; configured: boolean; result: SdkDryRunResult | undefined; onResult: (result: SdkDryRunResult) => void }> = ({ row, configured, result, onResult }) => {
  const [sample, setSample] = useState(true)
  const [running, setRunning] = useState(false)
  const defaults = useMemo(() => (row.generation ? sdkModelDefaults(row.modelId) : {}), [row])
  const run = async (): Promise<void> => {
    setRunning(true)
    try { onResult(await dryRunGenerationModel(row.modelId, undefined, { sample })) } finally { setRunning(false) }
  }
  const openInGeneration = (): void => {
    useGenerationDraftStore.getState().patch({ selectedModel: row.modelId, selectedProvider: row.providerId })
    openApplicationSurface('workspace.generation', { requestId: 'developer-panel' })
  }

  return (
    <div className="flex flex-col gap-6" data-sdk-model-detail={row.key}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={UI_TEXT_PANEL_TITLE_CLASS}>{row.name}</span>
          <span className={`break-all ${UI_TEXT_META_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.modelId}</span>
        </div>
        <UiIconButton size="sm" tooltip="复制 Model ID" aria-label="复制 Model ID" onClick={() => void writeClipboardText(row.modelId)}><Copy /></UiIconButton>
      </div>
      <UiGroup title="基本信息" titleTone="compact" labelWidth={96}>
        <UiFormRow label="供应商" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{providerName(row.providerId)}{row.generation || row.capability || row.llm ? (configured ? ' · 已配密钥' : ' · 未配密钥') : ''}</span></UiFormRow>
        <UiFormRow label="类别" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{CATEGORY_LABEL[row.category]}</span></UiFormRow>
        {row.tags.length ? <UiFormRow label="能力" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.tags.join(' · ')}</span></UiFormRow> : null}
        {row.rawTags.length ? <UiFormRow label="原始标签" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.rawTags.join(' ')}</span></UiFormRow> : null}
        {row.generation ? <>
          <UiFormRow label="通用标识" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.generation.definition.meta.canonicalModelId}</span></UiFormRow>
          <UiFormRow label="估价" density="compact"><PriceEstimate variant="badge" providerId={row.providerId} modelId={row.modelId} params={defaults} /></UiFormRow>
        </> : null}
        {row.llm ? <>
          <UiFormRow label="目录条目" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.llm.catalogId ?? '未登记（按纯文本处理）'}</span></UiFormRow>
          <UiFormRow label="接口" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.llm.protocol === 'responses' ? 'Responses' : row.llm.protocol === 'chat' ? 'Chat Completions' : '不在预设里'}</span></UiFormRow>
          <UiFormRow label="上下文" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.llm.contextWindow?.toLocaleString() ?? '未登记'} / 输出 {row.llm.maxOutputTokens?.toLocaleString() ?? '未登记'}</span></UiFormRow>
          {row.llm.note ? <UiFormRow label="备注" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.llm.note}</span></UiFormRow> : null}
        </> : null}
        {row.capability ? <>
          <UiFormRow label="能力 ID" density="compact"><span className={`break-all ${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.capability.descriptor.id}</span></UiFormRow>
          <UiFormRow label="执行方式" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.capability.descriptor.executionModes?.join(' · ') ?? '—'}</span></UiFormRow>
        </> : null}
      </UiGroup>
      {row.generation ? <>
        <UiGroup title="默认参数" titleTone="compact" divided>
          <UiPanel variant="inset" className="p-3">
            <div className={`flex flex-col gap-1 ${UI_TEXT_META_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>
              {Object.entries(defaults).map(([key, value]) => <span key={key} className="break-all">{key}: {formatValue(value)}</span>)}
            </div>
          </UiPanel>
        </UiGroup>
        <UiGroup title="离线检查" titleTone="compact" labelWidth={96} divided>
          <UiFormRow label="补示例输入" density="compact" info="默认为空的提示词、音色 ID 填一句示例，上传参数和素材按张数要求放占位地址">
            <UiSwitch checked={sample} onCheckedChange={setSample} />
          </UiFormRow>
          <UiFormRow label="" density="compact">
            <UiButton variant="secondary" size="sm" loading={running} onClick={() => void run()} data-sdk-dry-run="">构建请求</UiButton>
          </UiFormRow>
          {result ? (
            <div className="flex flex-col gap-2" data-sdk-dry-run-result={checkStatus(result)}>
              {result.ok
                ? <UiInlineStatus tone="success">{result.method} {result.route}</UiInlineStatus>
                : <UiInlineStatus tone="error">{result.error}</UiInlineStatus>}
              {result.ok ? (
                <UiPanel variant="inset" className="max-h-80 overflow-auto p-3">
                  <pre className={`whitespace-pre-wrap break-all ${UI_TEXT_META_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{JSON.stringify(result.body, null, 2)}</pre>
                </UiPanel>
              ) : null}
            </div>
          ) : null}
        </UiGroup>
        {row.category !== 'tool' ? (
          <UiGroup title="真实调用" titleTone="compact" divided>
            <UiButton variant="primary" onClick={openInGeneration} data-sdk-open-generation="" tooltip="在生成页选中这个模型，用正式链路提交；照常走付费策略">
              <Play />在生成页打开
            </UiButton>
          </UiGroup>
        ) : null}
      </> : null}
    </div>
  )
}
