// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorLayoutControlsV3 } from './ImageEditorLayoutControlsV3'

const fake=vi.hoisted(()=>({state:{status:'reviewing',draft:{id:'draft',fidelity:0,pins:[]},entries:[{layerId:'a',sample:{sampleId:'s'}}],candidates:[{id:'distribute',label:'边缘等距'}],selected:'distribute',needsSave:false},subscribe:()=>()=>undefined,
  organize:vi.fn(async()=>undefined),apply:vi.fn(async()=>undefined),configure:vi.fn(async()=>undefined),preview:vi.fn(),cancel:vi.fn(),reopen:vi.fn(async()=>undefined)}))
vi.mock('../application/imageEditLayoutDraft',()=>({imageEditLayoutDraft:()=>({...fake,snapshot:()=>fake.state})}))
afterEach(()=>{cleanup();vi.clearAllMocks();fake.state.selected='distribute';useImageEditorSessionStoreV3.getState().disposeSession('layout-ui')})
function mount(profile:'full'|'canvas-edit'|'quick'|'mask'):void {
  const document=createImageEditDocumentV3({width:1000,height:600,documentId:'layout-ui'})
  const store=useImageEditorSessionStoreV3.getState();store.ensureSession('layout-ui',['move']);store.setSelectedLayerIds('layout-ui',['a','b','c'])
  const controller={sessionId:'layout-ui',profile:{id:profile},document} as ImageEditorV3Controller
  render(<ImageEditorLayoutControlsV3 bus={new ImageEditCommandBusV3(document)} controller={controller}/>)
}
it.each(['full','canvas-edit'] as const)('%s 宿主共用候选与一次应用、原稿钉点入口',async profile=>{
  mount(profile);fireEvent.click(screen.getByRole('button',{name:'随手摆'}))
  const original=await screen.findByRole('button',{name:'原稿 A'});fireEvent.click(original)
  fireEvent.click(screen.getByRole('button',{name:'边缘等距 B'}))
  const pin=screen.getByRole('button',{name:'钉住所选图层的原稿位置'});pin.focus();fireEvent.click(pin)
  await waitFor(()=>expect(fake.configure).toHaveBeenCalledWith({pinIds:['a','b','c']}))
  expect(document.activeElement).toBe(pin)
  fireEvent.click(screen.getByRole('button',{name:'应用'}))
  await waitFor(()=>expect(fake.apply).toHaveBeenCalledOnce())
  expect(fake.preview.mock.calls.map(call=>call[0])).toEqual(['original','distribute'])
  expect(screen.queryByRole('button',{name:'开始示范'})).toBeNull()
})
it.each(['quick','mask'] as const)('%s 展示宿主不提供布局写入口',profile=>{
  mount(profile);expect(screen.queryByRole('button',{name:'随手摆'})).toBeNull()
})
it('原稿对照时选择单独主图后，再整理沿用原稿目标集合',async()=>{
  fake.state.selected='original'
  mount('full');fireEvent.click(screen.getByRole('button',{name:'随手摆'}))
  act(()=>useImageEditorSessionStoreV3.getState().setSelectedLayerIds('layout-ui',['a']))
  fireEvent.click(await screen.findByRole('button',{name:'整理'}))
  await waitFor(()=>expect(fake.organize).toHaveBeenCalledWith([]))
})
