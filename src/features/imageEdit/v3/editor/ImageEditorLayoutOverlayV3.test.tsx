// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { CreativeIntentGhost } from '@/features/creativeIntent'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { ImageEditorLayoutOverlayV3 } from './ImageEditorLayoutOverlayV3'

const state=vi.hoisted(()=>({selected:'align',candidates:[{id:'align'}],draft:{pins:[{sampleId:'sample'}]},entries:[{sample:{sampleId:'sample'},item:{worldCorners:[[10,20],[90,20],[10,20],[90,60]]}}]}))
const draw=vi.hoisted(()=>vi.fn())
vi.mock('../application/imageEditLayoutDraft',()=>({imageEditLayoutDraft:()=>({subscribe:()=>()=>undefined,snapshot:()=>state})}))
vi.mock('@/features/creativeIntent',()=>({CreativeIntentOverlay:(props:{ghosts:readonly CreativeIntentGhost[]})=>{draw(props.ghosts);return null}}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('重复 Alpha 支撑点呈现为真实轴边缘包围框，钉点在包围框中心',()=>{
  render(<ImageEditorLayoutOverlayV3 bus={new ImageEditCommandBusV3(createImageEditDocumentV3({width:100,height:80}))}/> )
  expect(draw).toHaveBeenLastCalledWith([{position:[.5,.5],turns:0,scale:1,pinned:true,breakBefore:true,corners:[[.1,.25],[.9,.25],[.9,.75],[.1,.75]]}])
})
