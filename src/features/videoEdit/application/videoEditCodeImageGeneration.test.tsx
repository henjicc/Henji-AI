// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import { catalog } from '@henjicc/ai-sdk'
import { registry } from '@/core/ModelRegistry'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { kiePresentation } from '@/models/presentation/kie'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { parseLegacyPromptString, toPromptPlainText } from '@/core/inputs/promptDocument'
import { useUiStore } from '@/stores/uiStore'
import { CodeImageParameterControl } from '../panels/CodeImageParameterControl'
import { CodeImageGenerationPanel } from '../panels/CodeImageGenerationPanel'
import { createLegacyTrackVideoEditProject, reopenVideoEdit } from './videoEditDocumentTestKit'
import { createVideoEditCodeItems } from './videoEditCodeService'
import { appendVideoEditItems } from './videoEditProjectItems'
import { readVideoEditCodeEditor } from './videoEditCodeParameters'
import { bindVideoEditCodeImage } from './videoEditCodeImages'
import { closeVideoEditProject, editVideoProject, listVideoEditInstances, subscribeVideoEdit, videoEditRevision, undoVideoEdit, saveVideoEdit, type VideoEditInstance } from './videoEditService'
import * as images from './videoEditCodeImageGeneration'

interface Task { status: string; resultAvailable: boolean; progress: number; cancellable: boolean; errorMessage?: string }
const state = vi.hoisted(() => ({ providers: ['kie'], tasks: new Map<string, Task>(), listeners: new Set<() => void>(), failTrial: false, submitGate: undefined as Promise<void> | undefined }))
const submit = vi.hoisted(() => vi.fn(async (_input: unknown, id: string) => { await state.submitGate; state.tasks.set(id, { status: 'pending', resultAvailable: false, progress: 0, cancellable: true }); return { taskId: id } }))
const cancel = vi.hoisted(() => vi.fn(async (id: string) => { state.tasks.set(id, { status: 'cancelled', progress: 0, resultAvailable: false, cancellable: false }) }))
vi.mock('@/features/generation/application/generationApplicationService', () => ({ generationApplicationService: {
  prepare: vi.fn(() => ({})), submit, getTask: (id: string) => { const task = state.tasks.get(id); if (!task) throw new Error('TASK_NOT_FOUND'); return task }, cancelTask: cancel,
} }))
vi.mock('@/core/services/GenerationService', () => ({ generationService: { getConfiguredProviders: async () => state.providers } }))
vi.mock('@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), subscribeVisibleGenerationTaskChanges: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener) } }))
vi.mock('@/features/generation/application/generationResultSource', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), readGenerationResultMedia: async (id: string) => ({ mediaType: 'image', source: `D:/generated/${id}.png`, name: id }) }))
vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class { async compile(source: string) { return compileCodeMaterial(source) } dispose() {} } }
})
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  async updateDocument() {} async dispose() {}
  async present() { if (state.failTrial) throw new Error('试渲染失败'); return { presented: true, bitmap: { width: 64, height: 64, close() {} } } }
} }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class { async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } dispose() {} } }))
// 表单边界只替换重量级编辑器的视图；数据仍是正式 PromptDocument 和参数。
vi.mock('@/components/ui/PromptEditor', () => ({ PromptEditor: ({ value, onChange, ariaLabel }: { value: Parameters<typeof toPromptPlainText>[0]; onChange: (value: ReturnType<typeof parseLegacyPromptString>) => void; ariaLabel: string }) => <div role="textbox" aria-label={ariaLabel} onClick={() => onChange(parseLegacyPromptString('助手修改后的产品图'))}>{toPromptPlainText(value)}</div> }))
vi.mock('@/components/MediaGenerator/components/ParameterPanel', () => ({ default: ({ selectedModel, values, toolbarLeading }: { selectedModel: string; values: Record<string, unknown>; toolbarLeading: React.ReactNode }) => <div>{toolbarLeading}<span data-testid="model">{selectedModel}</span><span data-testid="ratio">{String(values.kieGptImage2AspectRatio)}</span></div> }))
vi.mock('@/components/MediaGenerator/components/ModelSelectorPanel', () => ({ default: () => <div>模型目录</div> }))
vi.mock('@/components/ui/PriceEstimate', () => ({ default: () => <span>预计费用</span> }))
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: NonNullable<VideoEditInstance['document']['media']>; itemContent: (index: number, item: VideoEditInstance['document']['media'][number]) => React.ReactNode }) => <div>{data.map((item, index) => <div key={item.id}>{itemContent(index, item)}</div>)}</div> }))
vi.mock('@/components/ui/textMeasurement', () => ({ measureElementTextWidth: () => 30 }))

const source = 'export default {apiVersion:1,name:"产品画面",kind:"generator",mode:"static",width:640,height:360,durationSeconds:4,seed:1,parameters:{photo:{type:"image",title:"产品图",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.photo,x:0,y:0,width:200,height:100})];}}'
let owner: VideoEditInstance
const target = () => readVideoEditCodeEditor(owner.document.id, owner.activeSequenceId, owner.document.sequences[0].clips[0].id).target
const bound = () => owner.document.sequences[0].clips[0].code!.parameters.photo
const request = () => ({ target: target(), parameterKey: 'photo', prompt: '产品摄影' })
const assets = new Map<string, AssetRecord>()
const files = new Map<string, string>()
function notify(id: string, patch: Partial<Task>): void { Object.assign(state.tasks.get(id)!, patch); for (const listener of [...state.listeners]) listener() }
async function complete(job: images.CodeImageGenerationJob): Promise<void> { notify(job.taskId, { status: 'success', resultAvailable: true }); await waitFor(() => expect(job.status, job.error).toBe('placed')) }
function View(): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const editor = readVideoEditCodeEditor(owner.document.id, owner.activeSequenceId, owner.document.sequences[0].clips[0].id)
  return <CodeImageParameterControl target={editor.target} parameterKey="photo" title="产品图" value={editor.parameters.photo as { kind: 'image'; mediaId: string } | null} />
}
beforeEach(async () => {
  if (!registry.hasModel('kie-gpt-image-2')) registry.register(composeModelDefinition(catalog.find(model => model.meta.id === 'kie-gpt-image-2')!, kiePresentation['kie-gpt-image-2']))
  installHarnessNativeStorage(); images.resetCodeImageGenerationForTest(); state.tasks.clear(); state.providers = ['kie']; state.failTrial = false; state.submitGate = undefined; assets.clear(); files.clear(); vi.clearAllMocks()
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/image-generation.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/generated')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64) })
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const existing = [...assets.values()].find(asset => asset.filePath === input.filePath); if (existing) return existing
    const asset: AssetRecord = { id: `asset-${assets.size}`, filePath: input.filePath, mediaType: input.mediaType, displayName: `候选${assets.size + 1}`, displayUrl: '', source: input.source, mimeType: 'image/png', width: 200, height: 100, durationSeconds: 0, sizeBytes: 4096, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), inspectionStatus: 'ready', inspectionError: null, thumbnailPath: null, thumbnailUrl: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    assets.set(asset.id, asset); return asset
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
  owner = await createLegacyTrackVideoEditProject()
  const [item] = await createVideoEditCodeItems(owner.document.id, [{ source }])
  appendVideoEditItems(owner.document.id, [item], owner.activeSequenceId)
})
afterEach(async () => { cleanup(); images.resetCodeImageGenerationForTest(); await new Promise(resolve => setTimeout(resolve, 0)); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('默认KIE GPT image，画幅来自图片绘制矩形而非整个画布；提交前只准备不付费', async () => {
  const context = await images.prepareCodeImageGenerationContext(target(), 'photo')
  expect(context).toEqual({ prompt: '为「产品画面」创作「产品图」图片素材', width: 200, height: 100 })
  expect(images.codeImageGenerationDefaultParams(images.VIDEO_EDIT_CODE_IMAGE_DEFAULT_MODEL, context)).toMatchObject({ kieGptImage2AspectRatio: '2:1' })
  expect(submit).not.toHaveBeenCalled()
  const job = await images.startCodeImageGeneration(request())
  expect(job.modelId).toBe('kie-gpt-image-2'); expect(submit).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'kie-gpt-image-2', mediaType: 'image', options: expect.objectContaining({ kieGptImage2AspectRatio: '2:1' }) }), job.taskId)
})
it('无密钥安全拒绝；浮层提示并打开供应商设置，费用和默认模型复用现有组件', async () => {
  state.providers = []
  await expect(images.startCodeImageGeneration(request())).rejects.toThrow('配置密钥')
  expect(submit).not.toHaveBeenCalled()
  const view = render(<CodeImageGenerationPanel target={target()} parameterKey="photo" title="产品图" onClose={vi.fn()} />)
  await view.findByText('请先配置生成密钥')
  expect(view.getByRole('button', { name: '生成图片' }).hasAttribute('disabled')).toBe(true)
  expect(view.getByTestId('model').textContent).toBe('kie-gpt-image-2'); expect(view.getByText('预计费用')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '去设置' })); expect(useUiStore.getState().settingsTarget).toEqual({ tab: 'providers', sectionId: 'providers' })
})
it('v3 图片与测量文字混排仍按图片矩形推断画幅', async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText: (text: string) => ({ width: text.length * 20 }) } } })
  const mixed = source.replace('apiVersion:1,', 'apiVersion:1,languageVersion:3,').replace('return [image(', 'const m=measureText({text:"产品",fontSize:20});return [text({text:"产品",x:0,y:0,fontSize:20,color:[1,1,1,1]}),image(')
  const [item] = await createVideoEditCodeItems(owner.document.id, [{ source: mixed }])
  const [clipId] = appendVideoEditItems(owner.document.id, [item], owner.activeSequenceId)
  const editor = readVideoEditCodeEditor(owner.document.id, owner.activeSequenceId, clipId)
  expect(await images.prepareCodeImageGenerationContext(editor.target, 'photo')).toMatchObject({ width: 200, height: 100 })
})
it('进度取消走正式任务；迟到成功不导入、不绑定', async () => {
  const view = render(<View />)
  const job = await images.startCodeImageGeneration(request())
  act(() => notify(job.taskId, { progress: 37 }))
  await view.findByText('正在生成图片 37%')
  fireEvent.click(view.getByRole('button', { name: '取消生成' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(job.taskId, '已取消代码图片生成'))
  notify(job.taskId, { status: 'success', resultAvailable: true }); await new Promise(resolve => setTimeout(resolve, 0))
  expect(job.status).toBe('cancelled'); expect(bound()).toBeNull(); expect(owner.document.media).toEqual([])
})
it('浮层提交编辑后的提示词，关闭控件后后台仍完成；落库来源和绑定一步撤销', async () => {
  const view = render(<CodeImageGenerationPanel target={target()} parameterKey="photo" title="产品图" onClose={vi.fn()} />)
  await waitFor(() => expect(view.getByRole('button', { name: '生成图片' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(view.getByRole('textbox')); fireEvent.click(view.getByRole('button', { name: '生成图片' }))
  await waitFor(() => expect(images.codeImageGenerationJobs(target(), 'photo')).toHaveLength(1))
  const job = images.codeImageGenerationJobs(target(), 'photo')[0]; view.unmount()
  expect(job.request.prompt).toBe('助手修改后的产品图')
  const past = owner.past.length; await complete(job)
  expect(owner.past).toHaveLength(past + 1)
  expect(bound()).toEqual({ kind: 'image', mediaId: job.mediaId })
  expect(owner.document.media[0]).toMatchObject({ assetId: 'asset-0', codeImageGeneration: { prompt: job.request.prompt, modelId: 'kie-gpt-image-2', taskId: job.taskId, parameterKey: 'photo', outputIndex: 0 } })
  expect([...assets.values()][0].source).toBe('generated')
  undoVideoEdit(owner.document.id); expect(bound()).toBeNull(); expect(owner.document.media).toHaveLength(0); expect(assets.size).toBe(1)
})
it('连续生成保留候选，控件切换候选可以撤销，序列和参数归属隔离', async () => {
  const first = await images.startCodeImageGeneration(request()); await complete(first)
  const second = await images.startCodeImageGeneration(request()); await complete(second)
  expect(images.codeImageGenerationCandidates(target(), 'photo')).toHaveLength(2)
  expect(images.codeImageGenerationCandidates({ ...target(), effectId: 'other' }, 'photo')).toEqual([])
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '已生成 2 张' }))
  const before = owner.past.length; fireEvent.click(await view.findByRole('button', { name: '使用候选候选1' }))
  await waitFor(() => expect(bound()).toEqual({ kind: 'image', mediaId: first.mediaId }))
  expect(owner.past).toHaveLength(before + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(bound()).toEqual({ kind: 'image', mediaId: second.mediaId })
})
it('完成候选、绑定和生成来源随项目保存重开；来源属性可经通用实体读取', async () => {
  const job = await images.startCodeImageGeneration(request()); await complete(job)
  const original = target(); owner = await reopenVideoEdit(owner.document.id)
  expect(images.codeImageGenerationCandidates(original, 'photo')).toHaveLength(1)
  expect(bound()).toEqual({ kind: 'image', mediaId: job.mediaId })
  const app = createApplicationHarness()
  try {
    const read = await app.read({ kind: 'video_edit.media', id: `${owner.document.id}:${job.mediaId}` }, ['video_edit.media.code_image_generation'])
    expect(read.properties).toMatchObject({ 'video_edit.media.code_image_generation': { taskId: job.taskId, modelId: job.modelId, prompt: '产品摄影' } })
  } finally { app.dispose() }
})
it('试渲染失败不留下半导入；应用完成图片重试不再次生成', async () => {
  const job = await images.startCodeImageGeneration(request()); const before = owner.document; const history = owner.past.length
  state.failTrial = true; notify(job.taskId, { status: 'success', resultAvailable: true })
  await waitFor(() => expect(job.status).toBe('failed'))
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history); expect(assets.size).toBe(1)
  state.failTrial = false; images.retryCodeImageGenerationBinding(job.id)
  await waitFor(() => expect(job.status).toBe('placed')); expect(submit).toHaveBeenCalledTimes(1)
})
it('用户期间换图后拒绝覆盖；确认应用复用原完成结果', async () => {
  const first = await images.startCodeImageGeneration(request()); await complete(first)
  const second = await images.startCodeImageGeneration(request())
  await bindVideoEditCodeImage(target(), 'photo', null)
  notify(second.taskId, { status: 'success', resultAvailable: true })
  await waitFor(() => expect(second.status).toBe('failed')); expect(second.error).toContain('已选择其他图片'); expect(bound()).toBeNull()
  images.retryCodeImageGenerationBinding(second.id); await waitFor(() => expect(second.status).toBe('placed'))
  expect(submit).toHaveBeenCalledTimes(2)
})
it('保存失败后的重试只保存原绑定；用户随后撤销不会被重新应用', async () => {
  const job = await images.startCodeImageGeneration(request())
  const write = vi.spyOn(owner.session, 'flush').mockRejectedValue(new Error('磁盘写入失败'))
  notify(job.taskId, { status: 'success', resultAvailable: true }); await waitFor(() => expect(job.status).toBe('failed'))
  expect(job.mediaId).toBeTruthy(); const history = owner.past.length
  undoVideoEdit(owner.document.id); write.mockRestore()
  images.retryCodeImageGenerationBinding(job.id); await waitFor(() => expect(job.status).toBe('placed'))
  expect(owner.past).toHaveLength(history - 1); expect(bound()).toBeNull(); expect(submit).toHaveBeenCalledTimes(1)
})
it('提交未返回时取消，任务返回后仍请求正式取消', async () => {
  let resolve!: () => void; state.submitGate = new Promise<void>(done => { resolve = done })
  const job = await images.startCodeImageGeneration(request()); await images.cancelCodeImageGeneration(job.id)
  resolve(); await waitFor(() => expect(cancel).toHaveBeenCalledWith(job.taskId, '已取消代码图片生成'))
  expect(job.status).toBe('cancelled'); expect(bound()).toBeNull()
})
it('生成期间轨道锁定时不留下半导入或绑定', async () => {
  const job = await images.startCodeImageGeneration(request())
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks.find(track => track.index === document.sequences[0].clips[0].track)!.locked = true; return document })
  notify(job.taskId, { status: 'success', resultAvailable: true }); await waitFor(() => expect(job.status).toBe('failed'))
  expect(bound()).toBeNull(); expect(owner.document.media).toHaveLength(0)
})
it('助手正式桥梁导入生成结果，读取item媒体引用再通用实体绑定并回读撤销', async () => {
  const app = createApplicationHarness(); const id = owner.document.id
  try {
    const placed = await app.requireResult('place_video_edit_creative_result', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, placement: { mode: 'library' }, result: { type: 'generation', resultRef: { kind: 'generation.result', id: 'assistant-image' }, outputIndex: 0 } })
    const itemRef = placed.resultRef as { kind: string; id: string }
    const item = await app.read(itemRef, ['video_edit.item.media_id'])
    const mediaId = (item.properties as Record<string, unknown>)['video_edit.item.media_id']
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${target().clipId}` }
    const history = owner.past.length
    const changed = await app.change(clipRef, { 'video_edit.clip.code_parameters': { photo: { kind: 'image', mediaId } } })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(clipRef, ['video_edit.clip.code_parameters'])).properties).toEqual({ 'video_edit.clip.code_parameters': { photo: { kind: 'image', mediaId } } })
    expect(owner.past).toHaveLength(history + 1); undoVideoEdit(id); expect(bound()).toBeNull()
    expect(submit).not.toHaveBeenCalled(); await saveVideoEdit(id)
  } finally { app.dispose() }
})
