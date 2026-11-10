import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CircleCheck, CircleX, Copy, FlaskConical, ListChecks, X } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import {
  UI_TEXT_META_CLASS,
  UI_TEXT_PANEL_TITLE_CLASS,
  UI_TEXT_SECONDARY_CLASS,
  UI_TEXT_TIMECODE_CLASS,
  UiButton,
  UiCheckbox,
  UiChipButton,
  UiEmpty,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiInlineStatus,
  UiNavButton,
  UiOptionButton,
  UiPanel,
  UiResizeHandle,
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
import { ModelTestBench } from './ModelTestBench'
import { loadRecentGenerationFailures, type ModelFailureSummary } from './recentGenerationFailures'
import { checkLlmAvailability, llmAvailabilityKey, type LlmAvailability } from './llmAvailability'
import { dryRunGenerationModel, estimateSdkModelPrice, listSdkModels, sdkModelDefaults, sdkProviderName, SDK_MODEL_CATEGORIES, type SdkDryRunResult, type SdkModelCategory, type SdkModelPrice, type SdkModelRow } from './sdkModelInventory'

/** 三栏宽度与表格列宽都能拖，记在本机；能力列吃掉剩余宽度。 */
interface PanelLayout { filter: number; detail: number; model: number; provider: number; category: number; price: number }
const DEFAULT_LAYOUT: PanelLayout = { filter: 208, detail: 384, model: 280, provider: 104, category: 88, price: 112 }
const LAYOUT_LIMITS: Readonly<Record<keyof PanelLayout, readonly [number, number]>> = {
  filter: [160, 400], detail: [280, 960], model: [140, 640], provider: [64, 320], category: [56, 240], price: [64, 320],
}
const LAYOUT_STORAGE_KEY = 'henji.developer.sdkModels.layout'

function readLayout(): PanelLayout {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as Partial<PanelLayout>
    return Object.fromEntries((Object.keys(DEFAULT_LAYOUT) as Array<keyof PanelLayout>).map((key) => {
      const value = stored[key]
      const [min, max] = LAYOUT_LIMITS[key]
      return [key, typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DEFAULT_LAYOUT[key]]
    })) as unknown as PanelLayout
  } catch {
    return DEFAULT_LAYOUT
  }
}

function usePanelLayout(): { layout: PanelLayout; resize: (key: keyof PanelLayout) => Pick<React.ComponentProps<typeof UiResizeHandle>, 'value' | 'min' | 'max' | 'onChange' | 'onCommit'> } {
  const [layout, setLayout] = useState<PanelLayout>(readLayout)
  const resize = (key: keyof PanelLayout) => ({
    value: layout[key],
    min: LAYOUT_LIMITS[key][0],
    max: LAYOUT_LIMITS[key][1],
    onChange: (value: number) => setLayout((current) => ({ ...current, [key]: value })),
    onCommit: () => setLayout((current) => {
      try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(current)) } catch { /* 只是本机偏好 */ }
      return current
    }),
  })
  return { layout, resize }
}

const CATEGORY_LABEL: Readonly<Record<SdkModelCategory, string>> = {
  image: '图片', video: '视频', audio: '音频', tool: '图片工具', llm: '大语言模型', asr: '语音识别', translation: '翻译',
}

// 自动化与助手核对用：面板打开后可以在开发控制台或测试脚本里直接调用同一份清单与离线检查。
if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
  Object.assign(window as unknown as Record<string, unknown>, { __henjiSdkModels: { list: listSdkModels, dryRun: dryRunGenerationModel, prices: listSdkModelPrices } })
}

/** 全部模型的参考价，缺价格的带原因；在开发控制台里拿来列清单。 */
async function listSdkModelPrices(): Promise<Array<{ name: string; modelId: string; provider: string; category: string } & SdkModelPrice>> {
  const rows = listSdkModels()
  const prices = await Promise.all(rows.map(estimateSdkModelPrice))
  return rows.map((row, index) => ({ name: row.name, modelId: row.modelId, provider: providerName(row.providerId), category: CATEGORY_LABEL[row.category], ...prices[index] }))
}

function priceLabel(price: SdkModelPrice | undefined): string {
  if (!price) return '…'
  return price.status === 'missing' ? '缺价格' : price.display
}

/** 打开面板时读一次本机日志里最近 7 天的生成失败。 */
function useRecentFailures(): ReadonlyMap<string, ModelFailureSummary> {
  const [failures, setFailures] = useState<ReadonlyMap<string, ModelFailureSummary>>(new Map())
  useEffect(() => {
    let disposed = false
    loadRecentGenerationFailures()
      .then((result) => { if (!disposed) setFailures(result) })
      .catch((error: unknown) => logger.error('读取近期生成失败记录失败', error))
    return () => { disposed = true }
  }, [])
  return failures
}

/** 一次算完全部参考价：示例素材的指标是写死的，不读文件、不联网。 */
function useSdkModelPrices(rows: readonly SdkModelRow[]): ReadonlyMap<string, SdkModelPrice> {
  const [prices, setPrices] = useState<ReadonlyMap<string, SdkModelPrice>>(new Map())
  useEffect(() => {
    let disposed = false
    void Promise.all(rows.map(async (row) => [row.key, await estimateSdkModelPrice(row)] as const))
      .then((entries) => { if (!disposed) setPrices(new Map(entries)) })
    return () => { disposed = true }
  }, [rows])
  return prices
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
  const { layout, resize } = usePanelLayout()
  const rowColumns = { gridTemplateColumns: `${layout.model}px ${layout.provider}px ${layout.category}px ${layout.price}px minmax(0,1fr) 2rem` }
  const prices = useSdkModelPrices(rows)
  const failures = useRecentFailures()
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
  const [onlyUnpriced, setOnlyUnpriced] = useState(false)
  const [onlyRecentFailures, setOnlyRecentFailures] = useState(false)
  const [availability, setAvailability] = useState<LlmAvailability | null>(null)
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [onlyUnlisted, setOnlyUnlisted] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [checks, setChecks] = useState<ReadonlyMap<string, SdkDryRunResult>>(new Map())
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  // 测试台：一次只放同一类模型，勾了别的类别就从那一类重新开始
  const [testKeys, setTestKeys] = useState<readonly string[]>([])
  const [benchOpen, setBenchOpen] = useState(false)
  const testRows = useMemo(() => testKeys.flatMap((key) => rows.find((row) => row.key === key) ?? []), [rows, testKeys])
  const toggleTest = (row: SdkModelRow): void => setTestKeys((current) => current.includes(row.key)
    ? current.filter((key) => key !== row.key)
    : testRows[0] && testRows[0].category !== row.category ? [row.key] : [...current, row.key])

  const providerIds = useMemo(() => [...new Set(rows.map((row) => row.providerId).filter(Boolean))].sort(), [rows])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => (!category || row.category === category)
      && (!providers.size || providers.has(row.providerId))
      && (!onlyConfigured || (row.llm ? llmKeyStatus : keyStatus)[row.providerId] === true)
      && (!onlyFailed || checks.get(row.modelId)?.ok === false)
      && (!onlyUnpriced || isUnpriced(prices.get(row.key)))
      && (!onlyRecentFailures || failures.has(row.modelId))
      && (!onlyUnlisted || availability?.listed.get(llmAvailabilityKey(row.providerId, row.modelId)) === false)
      && (!needle || `${row.name} ${row.modelId} ${row.providerId} ${providerName(row.providerId)} ${row.tags.join(' ')} ${row.rawTags.join(' ')}`.toLowerCase().includes(needle)))
  }, [rows, query, category, providers, onlyConfigured, onlyFailed, onlyUnpriced, onlyRecentFailures, onlyUnlisted, availability, keyStatus, llmKeyStatus, checks, prices, failures])
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
  const checkAvailability = async (): Promise<void> => {
    setCheckingAvailability(true)
    try {
      const result = await checkLlmAvailability()
      if (mounted.current) setAvailability(result)
    } catch (error) {
      logger.error('核对大语言模型在售失败', error)
    } finally {
      if (mounted.current) setCheckingAvailability(false)
    }
  }
  const unlistedCount = availability ? [...availability.listed.values()].filter((listed) => !listed).length : 0
  const copyList = (): void => {
    const lines = filtered.map((row) => {
      const price = prices.get(row.key)
      return [row.name, row.modelId, providerName(row.providerId), CATEGORY_LABEL[row.category], price?.status === 'missing' ? `缺价格：${price.reason}` : priceLabel(price), checkLabel(checks.get(row.modelId))].join('\t')
    })
    void writeClipboardText(lines.join('\n'))
  }
  const failedCount = [...checks.values()].filter((result) => !result.ok).length

  if (benchOpen && testRows.length) {
    return <ModelTestBench rows={testRows} onBack={() => setBenchOpen(false)} onRemove={(key) => {
      const remaining = testKeys.filter((item) => item !== key)
      setTestKeys(remaining)
      // 列全移走就回到列表，免得之后勾一个模型测试台又立刻弹开
      if (!remaining.length) setBenchOpen(false)
    }} />
  }

  return (
    <>
      <UiToolbar
        variant="command"
        center={<UiSearchInput className="w-80" size="sm" placeholder="搜索名称、Model ID、供应商、能力" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />}
        trailing={<>
          {testRows.length ? <>
            <UiButton size="sm" variant="primary" onClick={() => setBenchOpen(true)} data-test-bench-open=""><FlaskConical />测试 {testRows.length} 个</UiButton>
            <UiIconButton tooltip="清空勾选" aria-label="清空勾选" onClick={() => setTestKeys([])}><X /></UiIconButton>
          </> : null}
          <UiButton size="sm" loading={checkingAvailability} onClick={() => void checkAvailability()} tooltip="用已配的密钥读取大语言模型供应商的模型列表（不收费），找出预设里已经不在列表的模型">
            <ListChecks />核对在售
          </UiButton>
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
      <div className="flex min-h-0 flex-1">
        <aside aria-label="筛选" className="flex min-h-0 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line p-3" style={{ width: layout.filter }}>
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
              <UiChipButton size="sm" active={onlyUnpriced} onClick={() => setOnlyUnpriced((value) => !value)} tooltip="算不出价格，或算出来是 0 要核对的">缺价格</UiChipButton>
              <UiChipButton size="sm" active={onlyRecentFailures} onClick={() => setOnlyRecentFailures((value) => !value)} tooltip="最近 7 天日常生成里失败过的模型，供应商拒绝请求多半是适配问题">近期失败 · {failures.size}</UiChipButton>
              {availability ? <UiChipButton size="sm" active={onlyUnlisted} onClick={() => setOnlyUnlisted((value) => !value)} tooltip="供应商模型列表里已经没有的预设模型，可能下架或改名">不在列表 · {unlistedCount}</UiChipButton> : null}
            </div>
          </UiGroup>
        </aside>
        <UiResizeHandle label="调整筛选栏宽度" {...resize('filter')} />
        <section aria-label="模型" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 表头和行同一套两段结构：勾选列 + 菜单项（菜单项自带 px-3），列宽才对得齐 */}
          <div className={`grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1 border-b border-line py-2 pl-4 pr-2 ${UI_TEXT_META_CLASS}`}>
            <span />
            <span className="grid gap-3 px-3" style={rowColumns}>
              <span className="relative"><span className="block truncate">模型</span><UiResizeHandle variant="column" label="调整模型列宽" {...resize('model')} /></span>
              <span className="relative"><span className="block truncate">供应商</span><UiResizeHandle variant="column" label="调整供应商列宽" {...resize('provider')} /></span>
              <span className="relative"><span className="block truncate">类别</span><UiResizeHandle variant="column" label="调整类别列宽" {...resize('category')} /></span>
              <span className="relative"><span className="block truncate">参考价</span><UiResizeHandle variant="column" label="调整参考价列宽" {...resize('price')} /></span>
              <span>能力</span><span>检查</span>
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <UiVirtualList
              data={filtered}
              getKey={(row) => row.key}
              resetKey={`${query}|${category}|${[...providers].join(',')}|${onlyConfigured}|${onlyFailed}|${onlyUnpriced}|${onlyRecentFailures}|${onlyUnlisted}`}
              emptyState={<UiEmpty title="没有符合条件的模型" />}
              renderItem={(row) => (
                <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1 pl-4 pr-2">
                <span className="flex justify-center">
                  <UiCheckbox checked={testKeys.includes(row.key)} onCheckedChange={() => toggleTest(row)} aria-label={`加入测试台：${row.name}`} data-test-bench-pick={row.key} />
                </span>
                <UiOptionButton
                  variant="menu"
                  active={row.key === selectedKey}
                  data-sdk-model-row={row.key}
                  data-check-status={checkStatus(checks.get(row.modelId))}
                  className="grid min-h-11 w-full items-center gap-3 text-left"
                  style={rowColumns}
                  onClick={() => setSelectedKey(row.key)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{row.name}</span>
                    <span className={`truncate ${UI_TEXT_META_CLASS} font-mono`}>{row.modelId}</span>
                  </span>
                  <span className={`truncate ${UI_TEXT_SECONDARY_CLASS}`}>{providerName(row.providerId)}</span>
                  <span className={`truncate ${UI_TEXT_SECONDARY_CLASS}`}>{CATEGORY_LABEL[row.category]}</span>
                  <PriceCell price={prices.get(row.key)} />
                  <span className={`truncate ${UI_TEXT_SECONDARY_CLASS}`}>{row.tags.join(' · ')}</span>
                  <CheckIcon result={checks.get(row.modelId)} />
                </UiOptionButton>
                </div>
              )}
            />
          </div>
        </section>
        <UiResizeHandle label="调整详情栏宽度" grow="start" {...resize('detail')} />
        <aside aria-label="模型详情" className="min-h-0 shrink-0 overflow-y-auto border-l border-line p-4" style={{ width: layout.detail }}>
          {selected
            ? <ModelDetail key={selected.key} row={selected} configured={isConfigured(selected)} price={prices.get(selected.key)} failure={failures.get(selected.modelId)} availability={availability} result={checks.get(selected.modelId)} onResult={(result) => record(selected.modelId, result)} />
            : <UiEmpty title="选一个模型查看详情" />}
        </aside>
      </div>
    </>
  )
}

const AvailabilityText: React.FC<{ row: SdkModelRow; availability: LlmAvailability }> = ({ row, availability }) => {
  const error = availability.errors.get(row.providerId)
  if (error) return <span className="text-warning-text">读不到模型列表：{error}</span>
  const listed = availability.listed.get(llmAvailabilityKey(row.providerId, row.modelId))
  if (listed === undefined) return <span className={UI_TEXT_SECONDARY_CLASS}>没配密钥，未核对</span>
  return listed
    ? <span className={UI_TEXT_SECONDARY_CLASS}>供应商模型列表里有</span>
    : <span className="text-warning-text">供应商模型列表里没有，可能已下架或改名</span>
}

function isUnpriced(price: SdkModelPrice | undefined): boolean {
  return price?.status === 'missing' || price?.status === 'zero'
}

const PriceCell: React.FC<{ price: SdkModelPrice | undefined }> = ({ price }) => {
  const cell = (
    <span className={`truncate ${UI_TEXT_TIMECODE_CLASS} ${price?.status === 'missing' ? 'text-warning-text' : UI_TEXT_SECONDARY_CLASS}`} data-sdk-price-status={price?.status ?? 'pending'}>
      {priceLabel(price)}
    </span>
  )
  return price?.status === 'missing' ? <Tooltip content={price.reason} asChild>{cell}</Tooltip> : cell
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

const ModelDetail: React.FC<{ row: SdkModelRow; configured: boolean; price: SdkModelPrice | undefined; failure: ModelFailureSummary | undefined; availability: LlmAvailability | null; result: SdkDryRunResult | undefined; onResult: (result: SdkDryRunResult) => void }> = ({ row, configured, price, failure, availability, result, onResult }) => {
  const [sample, setSample] = useState(true)
  const [running, setRunning] = useState(false)
  const defaults = useMemo(() => (row.generation ? sdkModelDefaults(row.modelId) : {}), [row])
  const run = async (): Promise<void> => {
    setRunning(true)
    try { onResult(await dryRunGenerationModel(row.modelId, undefined, { sample })) } finally { setRunning(false) }
  }

  return (
    <div className="flex flex-col gap-6" data-sdk-model-detail={row.key}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={UI_TEXT_PANEL_TITLE_CLASS}>{row.name}</span>
          <span className={`break-all ${UI_TEXT_META_CLASS} font-mono`}>{row.modelId}</span>
        </div>
        <UiIconButton size="sm" tooltip="复制 Model ID" aria-label="复制 Model ID" onClick={() => void writeClipboardText(row.modelId)}><Copy /></UiIconButton>
      </div>
      <UiGroup title="基本信息" titleTone="compact" labelWidth={96}>
        <UiFormRow label="供应商" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{providerName(row.providerId)}{row.generation || row.capability || row.llm ? (configured ? ' · 已配密钥' : ' · 未配密钥') : ''}</span></UiFormRow>
        <UiFormRow label="类别" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{CATEGORY_LABEL[row.category]}</span></UiFormRow>
        {row.deprecated ? <UiFormRow label="已过时" density="compact"><span className="text-warning-text">{row.deprecated}</span></UiFormRow> : null}
        <UiFormRow label="参考价" density="compact" info="生成模型按默认参数加示例输入（图 1024²、视频 5 秒、音频 10 秒）算；语音识别按每小时">
          {price?.status === 'missing'
            ? <span className="text-warning-text">缺价格：{price.reason}</span>
            : <span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{priceLabel(price)}{price?.status === 'zero' ? '（核对是否免费）' : ''}</span>}
        </UiFormRow>
        {failure ? (
          <UiFormRow label="近期失败" density="compact">
            <span className="flex flex-col gap-1">
              <span className="text-warning-text">最近 7 天 {failure.count} 次，最后一次 {new Date(failure.lastAt).toLocaleString()}</span>
              {failure.messages.map((message) => <span key={message} className={`break-all ${UI_TEXT_SECONDARY_CLASS}`}>{message}</span>)}
            </span>
          </UiFormRow>
        ) : null}
        {price?.description ? <UiFormRow label="计价说明" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{price.description}</span></UiFormRow> : null}
        {row.tags.length ? <UiFormRow label="能力" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.tags.join(' · ')}</span></UiFormRow> : null}
        {row.rawTags.length ? <UiFormRow label="原始标签" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} font-mono`}>{row.rawTags.join(' ')}</span></UiFormRow> : null}
        {row.generation ? <>
          <UiFormRow label="通用标识" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} font-mono`}>{row.generation.definition.meta.canonicalModelId}</span></UiFormRow>
        </> : null}
        {row.llm ? <>
          <UiFormRow label="目录条目" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} font-mono`}>{row.llm.catalogId ?? '未登记（按纯文本处理）'}</span></UiFormRow>
          {availability ? <UiFormRow label="在售" density="compact"><AvailabilityText row={row} availability={availability} /></UiFormRow> : null}
          <UiFormRow label="接口" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.llm.protocol === 'responses' ? 'Responses' : row.llm.protocol === 'chat' ? 'Chat Completions' : '不在预设里'}</span></UiFormRow>
          <UiFormRow label="上下文" density="compact"><span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`}>{row.llm.contextWindow?.toLocaleString() ?? '未登记'} / 输出 {row.llm.maxOutputTokens?.toLocaleString() ?? '未登记'}</span></UiFormRow>
          {row.llm.note ? <UiFormRow label="备注" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.llm.note}</span></UiFormRow> : null}
        </> : null}
        {row.capability ? <>
          <UiFormRow label="能力 ID" density="compact"><span className={`break-all ${UI_TEXT_SECONDARY_CLASS} font-mono`}>{row.capability.descriptor.id}</span></UiFormRow>
          <UiFormRow label="执行方式" density="compact"><span className={UI_TEXT_SECONDARY_CLASS}>{row.capability.descriptor.executionModes?.join(' · ') ?? '—'}</span></UiFormRow>
        </> : null}
      </UiGroup>
      {row.generation ? <>
        <UiGroup title="默认参数" titleTone="compact" divided>
          <UiPanel variant="inset" className="p-3">
            <div className={`flex flex-col gap-1 ${UI_TEXT_META_CLASS} font-mono`}>
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
                  <pre className={`whitespace-pre-wrap break-all ${UI_TEXT_META_CLASS} font-mono`}>{JSON.stringify(result.body, null, 2)}</pre>
                </UiPanel>
              ) : null}
            </div>
          ) : null}
        </UiGroup>
      </> : null}
      {/* 单个模型直接在这里调；要和同类模型并排对比，在列表里勾选多个再进测试台 */}
      <UiGroup title="真实调用" titleTone="compact" divided>
        <ModelTestBench layout="inline" rows={[row]} />
      </UiGroup>
    </div>
  )
}
