import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Play, Square } from 'lucide-react'
import {
  MediaStripUploader,
  UI_TEXT_META_CLASS,
  UI_TEXT_PANEL_TITLE_CLASS,
  UiButton,
  UiEmpty,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiInlineStatus,
  UiInput,
  UiSegmented,
  UiSwitch,
  UiTextArea,
  UiToolbar,
} from '@/components/ui'
import PriceEstimate from '@/components/ui/PriceEstimate'
import Tooltip from '@/components/ui/Tooltip'
import { applicationPaidOperationReceipt, bindPaidOperationReceipt } from '@/core/application-control/userConfirmation'
import type { PaidOperationCategory } from '@/core/application-control/paidApproval'
import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import { transferModelParamOverridesBetweenModels } from '@/core/params/modelParamTransfer'
import { getPathForFile } from '@/platform/desktopApi'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { PaidOperationCancelledError, withPaidOperation } from '@/services/paidApproval'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { ASR_CATALOG } from '@/core/audioEdit/asrCatalog'
import { EMPTY_TEST_MEDIA, modelAcceptsMedia, runAsrTest, runGenerationTest, runLlmTest, runTranslationTest, type TestMedia, type TestMediaKind } from './modelTestRunner'
import { applyGenerationParamChanges, LLM_CATALOG_ONLY_PROVIDER, type SdkModelCategory, type SdkModelRow } from './sdkModelInventory'
import { GenerationTestColumn, LlmTestColumn, TextTestColumn, type GenerationRun, type LlmRun, type TextRun } from './testBenchColumns'

const BENCH_LABEL: Readonly<Record<SdkModelCategory, string>> = {
  image: '图片', video: '视频', audio: '音频', tool: '图片工具', llm: '大语言模型', asr: '语音识别', translation: '翻译',
}
const MEDIA_LABEL: Readonly<Record<TestMediaKind, string>> = { images: '图片', videos: '视频', audios: '音频' }
const MEDIA_ACCEPT: Readonly<Record<TestMediaKind, string>> = { images: 'image/*', videos: 'video/*', audios: 'audio/*' }

const logger = createLogger('ModelTestBench')

type RunOutcome = 'done' | 'failed' | 'stopped'

type Approval = { receipt: NonNullable<ReturnType<typeof applicationPaidOperationReceipt>>; category: PaidOperationCategory }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError')
}

export const ModelTestBench: React.FC<{
  rows: readonly SdkModelRow[]
  /** page：整页并排对比；inline：嵌在模型详情里调一个模型，没有工具条，输入、运行与结果从上往下排 */
  layout?: 'page' | 'inline'
  onBack?: () => void
  onRemove?: (key: string) => void
}> = ({ rows, layout = 'page', onBack, onRemove }) => {
  const inline = layout === 'inline'
  const category = rows[0]?.category
  const kind = category === 'llm' || category === 'asr' || category === 'translation' ? category : 'generation'
  const isLlm = kind === 'llm'
  const controllers = useRef(new Map<string, AbortController>())
  useEffect(() => () => controllers.current.forEach((controller) => controller.abort()), [])

  // 生成类：共用提示词与素材，参数每列一份；开着“参数联动”时改一列，比例、时长这类通用参数带到其他列
  const [prompt, setPrompt] = useState('')
  const [media, setMedia] = useState<TestMedia>(EMPTY_TEST_MEDIA)
  const [sync, setSync] = useState(true)
  const [paramsByKey, setParamsByKey] = useState<Record<string, DynamicValueMap>>({})
  const [generationRuns, setGenerationRuns] = useState<Record<string, GenerationRun>>({})
  // 大语言模型：共用系统提示、消息、输出上限与思考开关
  const [system, setSystem] = useState('')
  const [user, setUser] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [reasoning, setReasoning] = useState<'setting' | 'on' | 'off'>('setting')
  const [llmRuns, setLlmRuns] = useState<Record<string, LlmRun>>({})
  // 语音识别：同一段音频；翻译：同一段原文与目标语言
  const [audioPath, setAudioPath] = useState('')
  const [language, setLanguage] = useState('zh')
  const [sourceText, setSourceText] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [textRuns, setTextRuns] = useState<Record<string, TextRun>>({})
  const [notice, setNotice] = useState<string | null>(null)

  const paramsOf = (row: SdkModelRow): DynamicValueMap => paramsByKey[row.key] ?? registry.getDefaultValues(row.modelId)
  const acceptedMedia = useMemo(() => (['images', 'videos', 'audios'] as const).filter((media) => kind === 'generation' && rows.some((row) => modelAcceptsMedia(row.modelId, media))), [rows, kind])
  const runs: Record<string, { status: string }> = kind === 'llm' ? llmRuns : kind === 'generation' ? generationRuns : textRuns
  const running = rows.some((row) => runs[row.key]?.status === 'running')

  const changeParams = (row: SdkModelRow, changes: DynamicValueMap): void => {
    // 在更新函数里基于最新值计算，连着两次改动不会丢前一次
    setParamsByKey((current) => {
      const next = applyGenerationParamChanges(row.modelId, current[row.key] ?? registry.getDefaultValues(row.modelId), changes)
      const updated = { ...current, [row.key]: next }
      if (!sync) return updated
      // 只带这次改的参数，不把源列别的改动整份搬过去，免得冲掉其他列里手改过的值
      const carriedSource = { ...registry.getDefaultValues(row.modelId), ...changes }
      for (const other of rows) {
        if (other.key === row.key) continue
        const carried = transferModelParamOverridesBetweenModels(row.modelId, other.modelId, carriedSource)
        if (Object.keys(carried).length) updated[other.key] = applyGenerationParamChanges(other.modelId, current[other.key] ?? registry.getDefaultValues(other.modelId), carried)
      }
      return updated
    })
  }

  /** 每列一个停止信号；批量运行时把那一次付费确认绑到每列的信号上，各列仍能单独停。 */
  const startController = (key: string, approval?: Approval): AbortController => {
    controllers.current.get(key)?.abort()
    const controller = new AbortController()
    controllers.current.set(key, controller)
    if (approval) {
      const release = bindPaidOperationReceipt(controller.signal, approval.receipt, approval.category)
      controller.signal.addEventListener('abort', release, { once: true })
    }
    return controller
  }
  // 停止后马上重跑时旧调用可能晚到：只有还是这一列当前那次运行，才允许写状态
  const isCurrent = (key: string, controller: AbortController): boolean => controllers.current.get(key) === controller
  const stop = (key: string): void => controllers.current.get(key)?.abort()
  const settle = (error: unknown, controller: AbortController): RunOutcome => isAbort(error, controller.signal) ? 'stopped' : 'failed'

  const runGeneration = async (row: SdkModelRow): Promise<RunOutcome> => {
    const controller = startController(row.key)
    const setRun = (run: GenerationRun): void => { if (isCurrent(row.key, controller)) setGenerationRuns((current) => ({ ...current, [row.key]: run })) }
    setRun({ status: 'running' })
    const startParams = paramsOf(row)
    try {
      const result = await runGenerationTest({
        modelId: row.modelId, prompt, params: startParams, media, signal: controller.signal,
        onProgress: (progress) => setRun({ status: 'running', progress: progress.progress, message: progress.message }),
      })
      // 按素材自动换了模式或渠道时，参数面板同步这两项；用户在等待期间自己改过的不覆盖
      if (isCurrent(row.key, controller)) {
        setParamsByKey((current) => {
          const base = current[row.key] ?? registry.getDefaultValues(row.modelId)
          const switched = Object.fromEntries(registry.getSchema(row.modelId)
            .filter((param) => param.role && result.params[param.id] !== undefined && base[param.id] === startParams[param.id] && base[param.id] !== result.params[param.id])
            .map((param) => [param.id, result.params[param.id]]))
          return Object.keys(switched).length ? { ...current, [row.key]: applyGenerationParamChanges(row.modelId, base, switched) } : current
        })
      }
      setRun({ status: 'done', result })
      return 'done'
    } catch (error) {
      const outcome = settle(error, controller)
      setRun(outcome === 'stopped' ? { status: 'stopped' } : { status: 'failed', error: errorText(error) })
      return outcome
    }
  }

  const llmBlocker = (row: SdkModelRow): string | null => row.providerId === LLM_CATALOG_ONLY_PROVIDER ? '只在能力目录里，没有供应商可调用' : null
  const runLlm = async (row: SdkModelRow, approval?: Approval): Promise<RunOutcome> => {
    const controller = startController(row.key, approval)
    let output = '', thought = ''
    const setRun = (run: Partial<LlmRun>): void => { if (isCurrent(row.key, controller)) setLlmRuns((current) => ({ ...current, [row.key]: { status: 'running', output, reasoning: thought, ...run } })) }
    setRun({})
    try {
      const result = await runLlmTest({
        providerId: row.providerId, modelId: row.modelId, system, user,
        maxOutputTokens: Number(maxTokens) > 0 ? Number(maxTokens) : undefined,
        reasoning: reasoning === 'setting' ? undefined : reasoning === 'on',
      }, {
        signal: controller.signal,
        onToken: (text) => { output += text; setRun({}) },
        onReasoning: (text) => { thought += text; setRun({}) },
      })
      setRun({ status: 'done', result })
      return 'done'
    } catch (error) {
      const outcome = settle(error, controller)
      setRun(outcome === 'stopped' ? { status: 'stopped' } : { status: 'failed', error: errorText(error) })
      return outcome
    } finally {
      controller.abort()
    }
  }

  // 实时识别要持续推送音频；只收公网网址的识别模型用本地文件测不了
  const textBlocker = (row: SdkModelRow): string | null => {
    const descriptor = row.capability?.descriptor
    if (descriptor?.executionModes?.includes('realtime')) return '实时识别需要持续推送音频，测试台暂不支持'
    if (descriptor && ASR_CATALOG.find((entry) => entry.descriptor.id === descriptor.id)?.localAudio === false) return '只收公网网址的音频，测试台用本地文件测不了'
    return null
  }
  const runText = async (row: SdkModelRow, approval?: Approval): Promise<RunOutcome> => {
    const controller = startController(row.key, approval)
    const setRun = (run: TextRun): void => { if (isCurrent(row.key, controller)) setTextRuns((current) => ({ ...current, [row.key]: run })) }
    setRun({ status: 'running' })
    try {
      const result = kind === 'asr'
        ? await runAsrTest({ modelId: row.capability?.descriptor.id ?? row.modelId, audioPath, language, signal: controller.signal })
        : await runTranslationTest({ moduleId: row.key.replace(/^translation:/, ''), text: sourceText, targetLanguage, signal: controller.signal })
      // 停止时主进程那次调用会被取消，万一结果先一步回来也不再显示
      if (controller.signal.aborted) return 'stopped'
      setRun({ status: 'done', result })
      return 'done'
    } catch (error) {
      const outcome = settle(error, controller)
      setRun(outcome === 'stopped' ? { status: 'stopped' } : { status: 'failed', error: errorText(error) })
      return outcome
    } finally {
      controller.abort()
    }
  }

  const blocker = kind === 'llm' ? llmBlocker : kind === 'generation' ? () => null : textBlocker
  const run = (row: SdkModelRow, approval?: Approval): Promise<RunOutcome> => kind === 'llm' ? runLlm(row, approval) : kind === 'generation' ? runGeneration(row) : runText(row, approval)
  const runOne = (row: SdkModelRow): void => { setNotice(null); if (!blocker(row)) void run(row) }
  /**
   * 大语言模型、识别、翻译拿不到单价，每次调用都要确认；全部运行时只确认一次，整批共用这次确认。
   * 生成模型有估价，照常按付费策略逐个判断。
   */
  const runAll = async (): Promise<void> => {
    setNotice(null)
    const targets = rows.filter((row) => !blocker(row))
    if (!targets.length) { setNotice('这些模型都不能在测试台里运行'); return }
    if (kind === 'generation') { targets.forEach((row) => void run(row)); return }
    const category = kind === 'asr' ? 'recognition' : kind === 'translation' ? 'translation' : 'generation'
    try {
      await withPaidOperation({ category }, async (signal) => {
        const receipt = applicationPaidOperationReceipt(signal)
        const outcomes = await Promise.all(targets.map((row) => run(row, receipt ? { receipt, category } : undefined)))
        // 一列都没成功时让这次确认记为失败，账本不把空跑当成完成
        if (!outcomes.includes('done')) throw new Error('这一批没有成功的调用')
      })
    } catch (error) {
      if (error instanceof PaidOperationCancelledError) return
      if (error instanceof ApplicationPreflightFailure) setNotice(errorText(error))
      else logger.warn('测试台批量运行没有成功的调用', { event: 'developer_test.batch_failed', context: { kind, count: targets.length, message: errorText(error) } })
    }
  }
  const stopRun = (key: string): void => {
    stop(key)
    if (kind === 'asr' || kind === 'translation') setTextRuns((current) => current[key]?.status === 'running' ? { ...current, [key]: { status: 'stopped' } } : current)
  }
  const remove = (key: string): void => {
    stopRun(key)
    controllers.current.delete(key)
    onRemove?.(key)
  }
  const missingInput = kind === 'llm' ? !user.trim() ? '先写好要发给模型的消息' : null
    : kind === 'asr' ? !audioPath ? '先选一段音频' : null
      : kind === 'translation' ? !sourceText.trim() ? '先写好要翻译的原文' : null
        : null

  if (!category) return <UiEmpty title="测试台里没有模型" />

  const inputs = <>
        {notice ? <UiInlineStatus tone="warning">{notice}</UiInlineStatus> : null}
        {kind === 'asr' ? (
          <UiGroup labelWidth={96}>
            <UiFormRow label="音频" density="compact">
              <MediaStripUploader files={audioPath ? [resolveImageDisplayUrl(audioPath)] : []} fileTypes={['audio']} accept="audio/*"
                onUpload={(files) => setAudioPath(getPathForFile(files[0]) || '')} onRemove={() => setAudioPath('')} />
            </UiFormRow>
            <UiFormRow label="语言" density="compact">
              <UiSegmented ariaLabel="识别语言" size="sm" value={language} onChange={setLanguage}
                options={[{ value: 'zh', label: '中文' }, { value: 'en', label: '英文' }, { value: 'ja', label: '日文' }, { value: 'yue', label: '粤语' }]} />
            </UiFormRow>
          </UiGroup>
        ) : kind === 'translation' ? (
          <UiGroup labelWidth={96}>
            <UiFormRow label="原文" density="compact">
              <UiTextArea height="medium" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="发给每个模型的同一段原文" data-test-bench-input="" />
            </UiFormRow>
            <UiFormRow label="译成" density="compact">
              <UiSegmented ariaLabel="目标语言" size="sm" value={targetLanguage} onChange={setTargetLanguage}
                options={[{ value: 'en', label: '英文' }, { value: 'zh', label: '中文' }, { value: 'ja', label: '日文' }, { value: 'ko', label: '韩文' }]} />
            </UiFormRow>
          </UiGroup>
        ) : isLlm ? <>
          <UiGroup labelWidth={96}>
            <UiFormRow label="系统提示" density="compact">
              <UiTextArea height="short" value={system} onChange={(event) => setSystem(event.target.value)} placeholder="可不填" />
            </UiFormRow>
            <UiFormRow label="消息" density="compact">
              <UiTextArea height="medium" value={user} onChange={(event) => setUser(event.target.value)} placeholder="发给每个模型的同一条消息" data-test-bench-input="" />
            </UiFormRow>
            <UiFormRow label="输出上限" density="compact" info="最多输出多少 token；不填按供应商默认">
              <UiInput size="sm" inputMode="numeric" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value.replace(/\D/g, ''))} placeholder="默认" />
            </UiFormRow>
            <UiFormRow label="思考" density="compact">
              <UiSegmented ariaLabel="思考" size="sm" value={reasoning} onChange={setReasoning}
                options={[{ value: 'setting', label: '默认', title: '按供应商设置里的思考开关' }, { value: 'on', label: '开' }, { value: 'off', label: '关' }]} />
            </UiFormRow>
          </UiGroup>
        </> : <>
          <UiTextArea height="short" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="提示词：发给每个模型的同一段描述" data-test-bench-input="" />
          {acceptedMedia.length ? (
            <div className="flex flex-wrap gap-6">
              {acceptedMedia.map((kind) => (
                <div key={kind} className="flex flex-col gap-1">
                  <span className={UI_TEXT_META_CLASS}>{MEDIA_LABEL[kind]} · 收不下的模型自动不带</span>
                  <MediaStripUploader
                    files={media[kind].map(resolveImageDisplayUrl)}
                    fileTypes={media[kind].map(() => kind === 'images' ? 'image' : kind === 'videos' ? 'video' : 'audio')}
                    accept={MEDIA_ACCEPT[kind]}
                    multiple
                    onUpload={(files) => {
                      const paths = files.map((file) => getPathForFile(file)).filter(Boolean)
                      setMedia((current) => ({ ...current, [kind]: [...current[kind], ...paths] }))
                    }}
                    onRemove={(index) => setMedia((current) => ({ ...current, [kind]: current[kind].filter((_, position) => position !== index) }))}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </>}
  </>
  const columns = <>
        {rows.map((row) => kind === 'asr' || kind === 'translation'
          ? <TextTestColumn key={row.key} embedded={inline} row={row} run={textRuns[row.key]} runnable={textBlocker(row)}
              onRun={() => runOne(row)} onStop={() => stopRun(row.key)} onRemove={() => remove(row.key)} />
          : isLlm
          ? <LlmTestColumn key={row.key} embedded={inline} row={row} run={llmRuns[row.key]} runnable={llmBlocker(row)}
              onRun={() => runOne(row)} onStop={() => stop(row.key)} onRemove={() => remove(row.key)} />
          : <GenerationTestColumn key={row.key} embedded={inline} row={row} params={paramsOf(row)} run={generationRuns[row.key]}
              onParamsChange={(changes) => changeParams(row, changes)}
              onRun={() => runOne(row)} onStop={() => stop(row.key)} onRemove={() => remove(row.key)} />)}
  </>

  if (inline) {
    const row = rows[0]
    const blocker = kind === 'llm' ? llmBlocker(row) : kind === 'generation' ? null : textBlocker(row)
    return (
      <div className="flex flex-col gap-4" data-test-bench={category} data-test-bench-inline="">
        {inputs}
        <div className="flex items-center gap-3">
          {running
            ? <UiButton size="sm" onClick={() => stopRun(row.key)}><Square />停止</UiButton>
            : <UiButton size="sm" variant="primary" disabled={missingInput !== null || blocker !== null} disabledReason={missingInput ?? blocker ?? undefined} onClick={() => void runOne(row)} data-test-bench-run={row.key}>
                <Play />运行
              </UiButton>}
          {kind === 'generation' ? <PriceEstimate variant="badge" providerId={row.providerId} modelId={row.modelId} params={paramsOf(row)} /> : null}
        </div>
        {columns}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-test-bench={category}>
      <UiToolbar
        variant="command"
        trailing={<>
          {!isLlm && rows.length > 1 ? (
            <Tooltip content="改一列的比例、分辨率、时长等通用参数时，同步到其他列" asChild>
              <label className="flex items-center gap-2">
                <span className={UI_TEXT_META_CLASS}>参数联动</span>
                <UiSwitch checked={sync} onCheckedChange={setSync} aria-label="参数联动" />
              </label>
            </Tooltip>
          ) : null}
          {running
            ? <UiButton size="sm" onClick={() => rows.forEach((row) => stopRun(row.key))}><Square />全部停止</UiButton>
            : <UiButton size="sm" variant="primary" disabled={missingInput !== null} disabledReason={missingInput ?? undefined} onClick={() => void runAll()} data-test-bench-run-all="">
                <Play />{rows.length > 1 ? `全部运行 ${rows.length} 个` : '运行'}
              </UiButton>}
        </>}
      >
        <UiIconButton tooltip="返回模型列表" aria-label="返回模型列表" onClick={() => onBack?.()}><ArrowLeft /></UiIconButton>
        <span className={UI_TEXT_PANEL_TITLE_CLASS}>测试台</span>
        <span className={UI_TEXT_META_CLASS}>{BENCH_LABEL[category]} · {rows.length} 个模型 · 真实调用，按付费策略计费</span>
      </UiToolbar>

      <div className="border-b border-line p-4">
        {/* 输入区限宽：铺满宽屏时一行太长不好读，下方各列照常横向铺开 */}
        <div className="flex max-w-3xl flex-col gap-4">
          {inputs}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {columns}
      </div>
    </div>
  )
}
