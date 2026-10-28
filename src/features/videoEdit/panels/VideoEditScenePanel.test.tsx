// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from '@/core/videoEdit/scene/sceneTestFixtures'
import { parseCodeSceneSchema } from '@/core/videoEdit/scene/sceneDeclaration'
import { resolveVideoEditScene } from '@/core/videoEdit/scene/sceneResolve'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useNavigationStore } from '@/stores/navigationStore'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { videoEditSceneTreeRows, writeVideoEditScene } from '../application/videoEditScenes'
import { closeVideoEditProject, editVideoProject, listVideoEditInstances, subscribeVideoEdit, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditScenePanel } from './VideoEditScenePanel'

vi.mock('../application/videoEditAuthorInspection', () => ({ inspectVideoEditAuthor: async (bundle: ReturnType<typeof testAuthorBundle>) => testAuthorProgram(bundle) }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/textMeasurement', () => ({ measureElementTextWidth: () => 30 }))
/** jsdom 里容器高度为 0，Virtuoso 一行都不渲染；替换为全量渲染，与被测逻辑无关。 */
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: unknown) => React.ReactNode }) => <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>,
}))

const source = `export default {name:"片子",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,params:[{key:"scene",type:"scene",title:"片子数据",schema:${JSON.stringify(GOLDEN_SCENE_DECLARATION)}}],draw(ctx,t,p){}}`
let owner: VideoEditInstance
let onError: ReturnType<typeof vi.fn>
beforeEach(async () => {
  installHarnessNativeStorage(); useNavigationStore.getState().setActiveWorkspace('videoEdit')
  owner = await createVideoEditTestProject(); onError = vi.fn()
  const program = testAuthorProgram(testAuthorBundle({ entry: 'main.ts', files: { 'main.ts': source }, apiVersion: 5 }))
  const version = { id: 'v', ...testCodeManifest(source, owner.document), apiVersion: 5 as const, languageVersion: program.languageVersion }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'screen', name: '录屏', path: 'D:/screen.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
    document.codeMaterials = [{ id: 'd', name: '片子', defaultVersionId: 'v', versions: [version] }]
    const scene = goldenScene('screen')
    // 整段落在剪切里的段落：解析时被丢掉
    scene.records.push({ id: 'seg-cut', kind: 'segment', values: { name: '剪掉的', start: 2.6, end: 2.8 } })
    document.scenes = [scene]
    document.items.push({ id: 'i', name: '片子', kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: { ...validateCodeMaterialParameters(program), scene: { kind: 'scene', sceneId: 'golden-scene' } } } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function View(): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditScenePanel instance={owner} onError={onError} visible /> }
const record = (id: string) => owner.document.scenes![0].records.find(item => item.id === id)!
const row = (view: ReturnType<typeof render>, id: string) => view.container.querySelector(`[data-video-edit-scene-record="${id}"]`) as HTMLElement
async function openRecord(view: ReturnType<typeof render>, id: string): Promise<HTMLElement> {
  fireEvent.click(within(row(view, id)).getAllByRole('button').at(-1)!)
  return await view.findByLabelText('记录字段')
}

it('记录树按声明的记录类型顺序与 parent 排列，收起的记录不列子记录', () => {
  const scene = owner.document.scenes![0]
  const schema = parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION)
  const resolved = resolveVideoEditScene(scene, schema)
  const rows = videoEditSceneTreeRows(scene, schema, resolved)
  // 声明顺序：段落、窗口（窗口内容挂在下面）、高亮（落点挂在下面）、剪切；同类按剪后开始
  expect(rows.map(item => [item.record.id, item.depth])).toEqual([['seg-switch', 0], ['seg-cut', 0], ['win-demo', 0], ['sh-1', 1], ['sh-2', 1], ['fo-1', 0], ['fk-1', 1], ['cut-1', 0]])
  expect(rows.find(item => item.record.id === 'seg-cut')!.resolved).toBeUndefined()
  expect(videoEditSceneTreeRows(scene, schema, resolved, new Set(['win-demo'])).map(item => item.record.id)).not.toContain('sh-1')
})

it('被剪掉的记录标出“已剪掉”，有问题的记录标出问题', async () => {
  editVideoProject(owner.document.id, document => ({ ...document, scenes: [{ ...document.scenes![0], records: [...document.scenes![0].records, { id: 'odd', kind: 'segment', values: { name: '缺结束', start: 3 } }] }] }))
  const view = render(<View />)
  await waitFor(() => expect(within(row(view, 'odd')).getByLabelText('有问题')).toBeTruthy())
  expect(within(row(view, 'seg-cut')).getByText('已剪掉')).toBeTruthy()
  expect(within(row(view, 'seg-switch')).queryByText('已剪掉')).toBeNull()
  const inspector = await openRecord(view, 'odd')
  expect(within(inspector).getByRole('status').textContent).toContain('缺少必填字段')
})

it('拖动数值整笔一步撤销；手调过的字段有标记，恢复自动只清标记', async () => {
  const view = render(<View />)
  const inspector = await openRecord(view, 'fk-1')
  const pad = within(inspector).getByRole('spinbutton', { name: 'pad' })
  const history = owner.past.length
  fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 0 })
  for (const clientX of [10, 20, 30]) fireEvent.pointerMove(pad, { pointerId: 1, clientX })
  const dragged = record('fk-1').values.pad as number
  expect(dragged).not.toBe(0.3)
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 30 })
  await waitFor(() => expect(owner.past).toHaveLength(history + 1))
  expect(record('fk-1')).toMatchObject({ values: { pad: dragged }, tuned: ['target', 'pad'] })
  // 恢复自动：标记去掉、取值不变，一步撤销
  fireEvent.click(within(inspector).getByRole('button', { name: '恢复自动：pad' }))
  await waitFor(() => expect(record('fk-1').tuned).toEqual(['target']))
  expect(record('fk-1').values.pad).toBe(dragged)
  expect(owner.past).toHaveLength(history + 2)
  undoVideoEdit(owner.document.id); expect(record('fk-1').tuned).toEqual(['target', 'pad'])
  undoVideoEdit(owner.document.id); expect(record('fk-1')).toMatchObject({ values: { pad: 0.3 }, tuned: ['target'] })
  expect(onError).not.toHaveBeenCalled()
})

it('渲染之后别处改了同一记录的其他字段，面板再改本字段时两处修改都保留', async () => {
  // 不订阅剪辑更新：面板停在渲染那一刻，模拟助手或另一次异步写入在面板重渲染之前落盘
  const view = render(<VideoEditScenePanel instance={owner} onError={onError} visible />)
  const inspector = await openRecord(view, 'cut-1')
  await writeVideoEditScene(owner.document.id, 'golden-scene', [{ kind: 'update', recordId: 'cut-1', values: { from: 2.6, to: 2.9, enabled: true } }])
  fireEvent.click(within(inspector).getByLabelText('enabled'))
  await waitFor(() => expect(record('cut-1').values).toEqual({ from: 2.6, to: 2.9, enabled: false }))
  // 拖动同理：按手势开始时的文档拼取值
  const fk = await openRecord(view, 'fk-1')
  await writeVideoEditScene(owner.document.id, 'golden-scene', [{ kind: 'update', recordId: 'fk-1', values: { ...record('fk-1').values, dur: 0.7 } }])
  const pad = within(fk).getByRole('spinbutton', { name: 'pad' })
  fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 0 })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 20 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 20 })
  await waitFor(() => expect(record('fk-1').tuned).toContain('pad'))
  expect(record('fk-1').values).toMatchObject({ dur: 0.7 })
  expect(record('fk-1').values.pad).not.toBe(0.3)
  expect(onError).not.toHaveBeenCalled()
})

/** 正式界面上不该出现的东西：记录 ID、结构标识与版本、写给助手的属性名与协议词。 */
const MISSING_MEDIA = '5b0e2c1a-7d41-4f0e-9a3b-2c6d8e1f4a70'
const INTERNAL = ['golden-scene', 'golden.film', 'fk-1', 'win-demo', 'sh-2', 'cut-1', 'ccac2339', MISSING_MEDIA, 'shot-image', 'gone', 'video', 'image', 'sceneId', 'scene_record', 'declaration_source', 'record_id', 'video_edit', 'values.', '{kind', '@']
function expectNoInternals(text: string): void { for (const word of INTERNAL) expect(text, word).not.toContain(word) }
function visibleText(view: ReturnType<typeof render>): string {
  const labels = [...view.container.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label'))
  return [view.container.textContent, ...labels].join('\n')
}

it('界面用记录名称与用户语言：没有名称的记录叫“类型 + 序号”，不能改的原因不露出协议文字', async () => {
  const nameless = 'ccac2339-6084-4e8e-b52a-0d88bcb33a29'
  editVideoProject(owner.document.id, document => { document.scenes![0].records.push({ id: nameless, kind: 'focus', values: {} }); return document })
  const view = render(<View />)
  const inspector = await openRecord(view, nameless)
  expect(within(row(view, nameless)).getByText('2')).toBeTruthy()
  expect(inspector.textContent).toContain('高亮2')
  await openRecord(view, 'fk-1')
  expectNoInternals(visibleText(view))
  // 没有代码片段再引用这份数据：说明用户能怎么办，不露出写给助手的做法
  act(() => { editVideoProject(owner.document.id, document => { document.sequences[0].clips = []; document.items = []; return document }) })
  await waitFor(() => expect(view.container.textContent).toContain('还没有代码片段使用这份数据'))
  expectNoInternals(visibleText(view))
})

it('修改被拒时给用户看的原因不带记录 ID 与属性名；引用的记录被删掉时下拉如实显示', async () => {
  const view = render(<View />)
  const inspector = await openRecord(view, 'seg-switch')
  const start = within(inspector).getByRole('spinbutton', { name: '开始' })
  // 开始挪到结束之后被拒
  act(() => { fireEvent.focus(start); fireEvent.change(start, { target: { value: '3' } }); fireEvent.blur(start) })
  await waitFor(() => expect(onError).toHaveBeenCalled())
  const message = (onError.mock.calls[0][0] as Error).message
  expect(message.startsWith('没有改成：')).toBe(true)
  expectNoInternals(message)
  expect(record('seg-switch').values.start).toBe(0.5)
  // fk-1 引用的窗口被删：直接改文档模拟旧数据，下拉显示“已删除的记录”而不是第一个窗口
  act(() => { editVideoProject(owner.document.id, document => { document.scenes![0].records.find(item => item.id === 'fk-1')!.values.win = 'gone'; return document }) })
  const fk = await openRecord(view, 'fk-1')
  expect(within(fk).getByLabelText('win').textContent).toContain('已删除的记录')
  expectNoInternals(visibleText(view))
})

it('素材与记录引用的问题用固定说法；正文里的数字不被当成记录 ID；序号按树里的顺序编', async () => {
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'shot-image', name: '截图', path: 'D:/shot.png', kind: 'image', durationSeconds: 5, width: 1920, height: 1080 })
    const records = document.scenes![0].records
    const at = (id: string) => records.find(item => item.id === id)!
    at('win-demo').values.media = MISSING_MEDIA
    at('sh-1').values.media = 'shot-image'
    at('fk-1').values.dur = 11
    // 短 ID “1”：问题原文“0–10”里的数字不能被换成记录名
    records.push({ id: '1', kind: 'focus', values: {} })
    // 文档里排在最后、树里排在中间（按开始时刻）的窗口内容
    records.push({ id: 'sh-0', kind: 'shot', parent: 'win-demo', values: { at: 0.7, media: 'screen', src: 0.5 } })
    return document
  })
  const view = render(<View />)
  expect((await openRecord(view, 'win-demo')).textContent).toContain('引用的素材已从剪辑里删除')
  expect((await openRecord(view, 'sh-1')).textContent).toContain('素材类型不对：这里要视频')
  expect((await openRecord(view, 'fk-1')).textContent).toContain('0–10')
  expectNoInternals(visibleText(view))
  expect(within(row(view, 'sh-0')).getByText('2')).toBeTruthy()
  expect(within(row(view, 'sh-2')).getByText('3')).toBeTruthy()
})

it('改剪后开始经领域服务写回未剪时刻，开始的字段记手调', async () => {
  const view = render(<View />)
  const inspector = await openRecord(view, 'sh-2')
  const start = within(inspector).getByRole('spinbutton', { name: '开始' })
  const history = owner.past.length
  act(() => { fireEvent.focus(start); fireEvent.change(start, { target: { value: '1.8' } }); fireEvent.blur(start) })
  await waitFor(() => expect(owner.past).toHaveLength(history + 1))
  expect(record('sh-2')).toMatchObject({ values: { at: 1.8 }, tuned: ['at'] })
  expect(onError).not.toHaveBeenCalled()
})
