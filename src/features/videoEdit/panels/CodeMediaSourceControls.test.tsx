// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { HENJI_DRAG_DATA_MIME } from '@/contexts/dragDataTransfer'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { openAssetLibrary } from '@/stores/navigationStore'
import { bindVideoEditCodeImage, chooseVideoEditCodeImage } from '../application/videoEditCodeImages'
import { commitVideoEditCodeCandidate, disposeVideoEditCodeCandidate, prepareVideoEditCodeCandidate, type VideoEditCodeCandidate } from '../application/videoEditCodeCandidates'
import { readVideoEditCodeEditor, setVideoEditCodeParameter } from '../application/videoEditCodeParameters'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { VIDEO_EDIT_ITEM_DRAG_MIME } from '../application/videoEditDrop'
import { appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { CodeImageParameterControl } from './CodeImageParameterControl'
import { VideoEditEffectsPanel } from './VideoEditEffectsPanel'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/textMeasurement', () => ({ measureElementTextWidth: () => 30 }))
vi.mock('@/stores/navigationStore', () => ({ openAssetLibrary: vi.fn() }))
vi.mock('../application/videoEditCodeImages', () => ({ bindVideoEditCodeImage: vi.fn(), chooseVideoEditCodeImage: vi.fn() }))
vi.mock('../application/videoEditCodeCandidates', () => ({ prepareVideoEditCodeCandidate: vi.fn(), commitVideoEditCodeCandidate: vi.fn(), disposeVideoEditCodeCandidate: vi.fn() }))
// Domain compilation/import/trial is tested at its facade. These tests isolate UI authority and resource ownership.
const source = `export default {apiVersion:1,name:"图片代码",kind:"generator",mode:"static",width:64,height:64,durationSeconds:5,seed:1,parameters:{logo:{type:"image",title:"图片",default:null},amount:{type:"number",title:"强度",default:5,min:0,max:10,step:1}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:64,height:64})];}}`
let owner: VideoEditInstance
let sequenceId: string
let clipIds: string[]
let onError: ReturnType<typeof vi.fn>
let draw: ReturnType<typeof vi.fn>
const editor = (index = 0) => readVideoEditCodeEditor(owner.document.id, sequenceId, clipIds[index])
function View({ visible = true }: { visible?: boolean }): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditEffectsPanel instance={owner} onError={onError} visible={visible} /> }
function transfer(type: string, value: unknown, files: File[] = []): DataTransfer { return { types: [type], files, getData: (requested: string) => requested === type ? JSON.stringify(value) : '' } as unknown as DataTransfer }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail }); return { promise, resolve, reject } }
function candidate(overrides: Partial<VideoEditCodeCandidate> = {}): VideoEditCodeCandidate { return { target: editor().target, source, scope: 'single', versionId: 'internal-candidate-version', clipCount: 1, bitmap: { width: 3840, height: 2160, close: vi.fn() } as unknown as ImageBitmap, impacts: [], ...overrides } }
async function check(view: ReturnType<typeof render>): Promise<void> { await act(async () => { fireEvent.click(view.getByRole('button', { name: '检查并预览' })) }) }

beforeEach(async () => {
  installHarnessNativeStorage(); onError = vi.fn(); draw = vi.fn()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/code-ui-source.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  vi.mocked(bindVideoEditCodeImage).mockReset().mockResolvedValue(undefined)
  vi.mocked(chooseVideoEditCodeImage).mockReset().mockResolvedValue(undefined)
  vi.mocked(prepareVideoEditCodeCandidate).mockReset()
  vi.mocked(commitVideoEditCodeCandidate).mockReset().mockReturnValue('accepted')
  const disposed = new WeakSet<VideoEditCodeCandidate>()
  vi.mocked(disposeVideoEditCodeCandidate).mockReset().mockImplementation(proof => { if (!disposed.has(proof)) { disposed.add(proof); proof.bitmap.close() } })
  vi.mocked(openAssetLibrary).mockClear()
  owner = (await createVideoEditProject())!
  const program = compileCodeMaterial(source); const version = { id: 'v', source, apiVersion: 1 as const, languageVersion: program.languageVersion }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(owner.document.id, document => {
    document.codeMaterials = [{ id: 'd', name: program.name, defaultVersionId: 'v', versions: [version] }]
    document.items.push({ id: 'i', name: program.name, kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: { logo: null, amount: 5 } } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)), makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
  appendVideoEditMedia(owner.document.id, { id: 'imageA', name: '图片素材A', kind: 'image', path: 'D:/originalA.png', width: 64, height: 64, durationSeconds: 1 })
  appendVideoEditMedia(owner.document.id, { id: 'imageB', name: '图片素材B', kind: 'image', path: 'D:/originalB.png', width: 64, height: 64, durationSeconds: 1 })
  appendVideoEditMedia(owner.document.id, { id: 'video', name: '视频素材', kind: 'video', path: 'D:/original.mp4', width: 64, height: 64, durationSeconds: 1, frameRateMode: 'unknown' })
  sequenceId = owner.activeSequenceId; clipIds = getActiveVideoEditSequence(owner).clips.map(clip => clip.id)
  setVideoEditView(owner.document.id, { selection: clipIds[0] })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('图片参数复用项目图片、正式文件选择、资产库和清除，所有动作绑定原实例', async () => {
  setVideoEditCodeParameter(editor().target, 'logo', { kind: 'image', mediaId: 'imageA' })
  const target = editor().target; const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '图片项目图片' })); await act(async () => { fireEvent.click(view.getByText('图片素材B')) })
  expect(bindVideoEditCodeImage).toHaveBeenLastCalledWith(target, 'logo', { kind: 'media', mediaId: 'imageB' }, expect.any(AbortSignal))
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '选择文件' })) })
  expect(chooseVideoEditCodeImage).toHaveBeenCalledWith(target, 'logo', expect.any(AbortSignal))
  fireEvent.click(view.getByRole('button', { name: '从资产库拖入' })); expect(openAssetLibrary).toHaveBeenCalledWith('floating')
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '清除图片' })) })
  expect(bindVideoEditCodeImage).toHaveBeenLastCalledWith(target, 'logo', null, expect.any(AbortSignal))
  expect(owner.document.media.find(media => media.id === 'imageA')!.path).toBe('D:/originalA.png'); expect(onError).not.toHaveBeenCalled()
})

it('资产拖包的路径不参与绑定，项目项必须来自当前剪辑且是单张图片，文件拖入保留原路径', async () => {
  const view = render(<View />); const drop = view.getByLabelText('图片图片拖放区')
  await act(async () => { fireEvent.drop(drop, { dataTransfer: transfer(HENJI_DRAG_DATA_MIME, { type: 'image', sourceType: 'asset', assetId: 'assetA', filePath: 'D:/forged.png', imageUrl: 'media:assetA' }) }) })
  expect(bindVideoEditCodeImage).toHaveBeenLastCalledWith(editor().target, 'logo', { kind: 'asset', assetId: 'assetA' }, expect.any(AbortSignal))
  const imageItem = owner.document.items.find(item => item.mediaId === 'imageA')!.id
  await act(async () => { fireEvent.drop(drop, { dataTransfer: transfer(VIDEO_EDIT_ITEM_DRAG_MIME, { projectId: owner.document.id, itemIds: [imageItem] }) }) })
  expect(bindVideoEditCodeImage).toHaveBeenLastCalledWith(editor().target, 'logo', { kind: 'media', mediaId: 'imageA' }, expect.any(AbortSignal))
  vi.mocked(bindVideoEditCodeImage).mockClear()
  fireEvent.drop(drop, { dataTransfer: transfer(VIDEO_EDIT_ITEM_DRAG_MIME, { projectId: 'other-project', itemIds: [imageItem] }) })
  const videoItem = owner.document.items.find(item => item.mediaId === 'video')!.id
  fireEvent.drop(drop, { dataTransfer: transfer(VIDEO_EDIT_ITEM_DRAG_MIME, { projectId: owner.document.id, itemIds: [videoItem] }) })
  fireEvent.drop(drop, { dataTransfer: transfer(VIDEO_EDIT_ITEM_DRAG_MIME, { projectId: owner.document.id, itemIds: [imageItem, imageItem] }) })
  expect(bindVideoEditCodeImage).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
  vi.spyOn(getPlatform().media, 'getPathForFile').mockReturnValue('D:/drag-original.png')
  await act(async () => { fireEvent.drop(drop, { dataTransfer: transfer('Files', '', [new File([], 'original.png')]) }) })
  expect(bindVideoEditCodeImage).toHaveBeenLastCalledWith(editor().target, 'logo', { kind: 'file', path: 'D:/drag-original.png' }, expect.any(AbortSignal))
})

it('图片选择随目标变更或面板隐藏取消，旧请求晚到失败不污染新界面', async () => {
  const result = deferred<void>(); vi.mocked(chooseVideoEditCodeImage).mockReturnValue(result.promise)
  const view = render(<CodeImageParameterControl target={editor().target} parameterKey="logo" title="图片" value={null} />)
  fireEvent.click(view.getByRole('button', { name: '选择文件' }))
  const signal = vi.mocked(chooseVideoEditCodeImage).mock.calls[0][2]!
  view.rerender(<CodeImageParameterControl target={editor(1).target} parameterKey="logo" title="图片" value={null} />)
  expect(signal.aborted).toBe(true); expect(view.queryByText('正在应用图片')).toBeNull()
  await act(async () => result.reject(new Error('旧选择失败'))); expect(onError).not.toHaveBeenCalled()
  view.unmount()
  const second = deferred<void>(); vi.mocked(chooseVideoEditCodeImage).mockReturnValue(second.promise)
  const panel = render(<View />); fireEvent.click(panel.getByRole('button', { name: '选择文件' }))
  const hiddenSignal = vi.mocked(chooseVideoEditCodeImage).mock.calls.at(-1)![2]!
  panel.rerender(<View visible={false} />); expect(hiddenSignal.aborted).toBe(true)
  await act(async () => second.resolve()); expect(onError).not.toHaveBeenCalled()
})

it('源码按需展开，检查生成真实候选画布，单片段提交携带原目标且不展示内部标识', async () => {
  const proof = candidate(); vi.mocked(prepareVideoEditCodeCandidate).mockResolvedValue(proof)
  const view = render(<View />); expect(view.queryByRole('textbox', { name: '代码素材源码' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' })); expect((view.getByRole('textbox', { name: '代码素材源码' }) as HTMLTextAreaElement).value).toBe(source)
  expect(view.getByRole('button', { name: '应用已检查源码' }).hasAttribute('disabled')).toBe(true)
  await check(view)
  expect(prepareVideoEditCodeCandidate).toHaveBeenCalledWith(editor().target, source, 'single', expect.any(AbortSignal))
  expect(draw).toHaveBeenCalledWith(proof.bitmap, 0, 0)
  const canvas = view.getByLabelText('源码候选预览') as HTMLCanvasElement; expect([canvas.width, canvas.height]).toEqual([3840, 2160])
  expect(view.container.textContent).not.toContain(proof.versionId)
  fireEvent.click(view.getByRole('button', { name: '应用已检查源码' }))
  expect(commitVideoEditCodeCandidate).toHaveBeenCalledWith(proof, false); expect(proof.bitmap.close).toHaveBeenCalledTimes(1); expect([canvas.width, canvas.height]).toEqual([0, 0]); expect(onError).not.toHaveBeenCalled()
})

it('批量范围明确选择，迁移逐项显示原值和动画影响，勾选前不能提交', async () => {
  const proof = candidate({ scope: 'matching', clipCount: 2, impacts: [{ key: 'amount', title: '强度', reason: '参数已删除', resetValue: true, removeCurve: true, sequenceName: '序列甲', clipName: '片段甲' }] })
  vi.mocked(prepareVideoEditCodeCandidate).mockResolvedValue(proof)
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' }))
  fireEvent.click(view.getByRole('button', { name: '源码应用范围' })); fireEvent.click(view.getByText('相同原版本的所有片段')); await check(view)
  expect(prepareVideoEditCodeCandidate).toHaveBeenCalledWith(editor().target, source, 'matching', expect.any(AbortSignal))
  expect(view.getByText('序列甲 · 片段甲 · 强度')).toBeTruthy(); expect(view.getByText('参数已删除；移除原值；移除已有关键帧')).toBeTruthy(); expect(view.getByText('将应用到 2 个片段')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '应用已检查源码' })); expect(commitVideoEditCodeCandidate).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('checkbox', { name: '确认参数与关键帧迁移' })); fireEvent.click(view.getByRole('button', { name: '应用已检查源码' }))
  expect(commitVideoEditCodeCandidate).toHaveBeenCalledWith(proof, true); expect(onError).not.toHaveBeenCalled()
})

it('编译失败保留有效剪辑并呈现诊断，恢复当前源码仅恢复草稿', async () => {
  vi.mocked(prepareVideoEditCodeCandidate).mockRejectedValue(new Error('第2行：未知语法'))
  const baseline = owner.document; const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' }))
  fireEvent.change(view.getByRole('textbox', { name: '代码素材源码' }), { target: { value: '错误源码' } }); await check(view)
  expect(view.getByRole('alert').textContent).toContain('第2行：未知语法'); expect(owner.document).toBe(baseline); expect(commitVideoEditCodeCandidate).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '恢复当前源码' })); expect((view.getByRole('textbox', { name: '代码素材源码' }) as HTMLTextAreaElement).value).toBe(source); expect(view.queryByRole('alert')).toBeNull()
})

it('编辑草稿和范围取消检查并释放晚到候选，关闭编辑与换选区也释放原请求', async () => {
  const first = deferred<VideoEditCodeCandidate>(); vi.mocked(prepareVideoEditCodeCandidate).mockReturnValueOnce(first.promise)
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' })); fireEvent.click(view.getByRole('button', { name: '检查并预览' }))
  const firstSignal = vi.mocked(prepareVideoEditCodeCandidate).mock.calls[0][3]!
  fireEvent.change(view.getByRole('textbox', { name: '代码素材源码' }), { target: { value: `${source}\n` } }); expect(firstSignal.aborted).toBe(true)
  const late = candidate(); await act(async () => first.resolve(late)); expect(late.bitmap.close).toHaveBeenCalledTimes(1); expect(view.queryByLabelText('源码候选预览')).toBeNull()
  const ready = candidate(); vi.mocked(prepareVideoEditCodeCandidate).mockResolvedValue(ready); await check(view)
  fireEvent.click(view.getByRole('button', { name: '源码应用范围' })); fireEvent.click(view.getByText('相同原版本的所有片段')); expect(ready.bitmap.close).toHaveBeenCalledTimes(1)
  const second = deferred<VideoEditCodeCandidate>(); vi.mocked(prepareVideoEditCodeCandidate).mockReturnValue(second.promise); fireEvent.click(view.getByRole('button', { name: '检查并预览' }))
  const secondSignal = vi.mocked(prepareVideoEditCodeCandidate).mock.calls.at(-1)![3]!
  fireEvent.click(view.getByRole('button', { name: '收起源码编辑' })); expect(secondSignal.aborted).toBe(true)
  const hidden = candidate(); await act(async () => second.resolve(hidden)); expect(hidden.bitmap.close).toHaveBeenCalledTimes(1)
  fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' })); const third = deferred<VideoEditCodeCandidate>(); vi.mocked(prepareVideoEditCodeCandidate).mockReturnValue(third.promise); fireEvent.click(view.getByRole('button', { name: '检查并预览' }))
  const thirdSignal = vi.mocked(prepareVideoEditCodeCandidate).mock.calls.at(-1)![3]!
  act(() => setVideoEditView(owner.document.id, { selection: clipIds[1] })); expect(thirdSignal.aborted).toBe(true)
  const switched = candidate(); await act(async () => third.resolve(switched)); expect(switched.bitmap.close).toHaveBeenCalledTimes(1); expect(view.queryByRole('textbox', { name: '代码素材源码' })).toBeNull(); expect(onError).not.toHaveBeenCalled()
})

it('外部剪辑修改立即使候选不可提交，自身提交的发布不被误判为取消', async () => {
  const first = candidate(); vi.mocked(prepareVideoEditCodeCandidate).mockResolvedValue(first)
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' })); await check(view)
  act(() => setVideoEditCodeParameter(editor().target, 'amount', 6))
  expect(first.bitmap.close).toHaveBeenCalledTimes(1); expect(view.getByRole('button', { name: '应用已检查源码' }).hasAttribute('disabled')).toBe(true)
  const second = candidate(); vi.mocked(prepareVideoEditCodeCandidate).mockResolvedValue(second); await check(view)
  vi.mocked(commitVideoEditCodeCandidate).mockImplementation(() => { setVideoEditCodeParameter(editor().target, 'amount', 7); return 'accepted' })
  fireEvent.click(view.getByRole('button', { name: '应用已检查源码' }))
  expect(editor().parameters.amount).toBe(7); expect(second.bitmap.close).toHaveBeenCalledTimes(1); expect(view.queryByRole('alert')).toBeNull(); expect(onError).not.toHaveBeenCalled()
})

it('候选画面呈现失败释放证明与资源，恢复检查后才可提交', async () => {
  const proof = candidate(); vi.mocked(prepareVideoEditCodeCandidate).mockResolvedValue(proof); draw.mockImplementation(() => { throw new Error('候选画面不可用') })
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' })); await check(view)
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('候选画面不可用'))
  expect(proof.bitmap.close).toHaveBeenCalledTimes(1); expect(view.getByRole('button', { name: '应用已检查源码' }).hasAttribute('disabled')).toBe(true); expect(commitVideoEditCodeCandidate).not.toHaveBeenCalled()
})

it('异步图片失败保留原绑定，隐藏整个面板取消源码检查并释放晚到画面', async () => {
  setVideoEditCodeParameter(editor().target, 'logo', { kind: 'image', mediaId: 'imageA' })
  vi.mocked(chooseVideoEditCodeImage).mockRejectedValue(new Error('图片不可用，请重新选择。'))
  const view = render(<View />)
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '选择文件' })) })
  expect(editor().parameters.logo).toEqual({ kind: 'image', mediaId: 'imageA' }); expect(view.getByRole('alert').textContent).toContain('图片不可用'); expect(onError).not.toHaveBeenCalled()
  const result = deferred<VideoEditCodeCandidate>(); vi.mocked(prepareVideoEditCodeCandidate).mockReturnValue(result.promise)
  fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' })); fireEvent.click(view.getByRole('button', { name: '检查并预览' }))
  const signal = vi.mocked(prepareVideoEditCodeCandidate).mock.calls.at(-1)![3]!
  view.rerender(<View visible={false} />); expect(signal.aborted).toBe(true)
  const late = candidate(); await act(async () => result.resolve(late))
  expect(late.bitmap.close).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled(); expect(commitVideoEditCodeCandidate).not.toHaveBeenCalled()
})
