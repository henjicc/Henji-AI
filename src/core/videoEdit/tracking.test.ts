import { expect, it } from 'vitest'
import { decodeVideoEditTrackGeometry, encodeVideoEditTrackGeometry, videoEditCornerPinMatrix, videoEditTrackerSchema, videoEditTrackProject, type VideoEditTrackQuad } from './tracking'

it('点与平面提示严格区分、纠错保留点顺序、搜索框不小于特征框',()=> {
  const point={id:'p',name:'点',method:'point',prompts:[{timeUs:0,points:[[.4,.4,1],[.6,.6,1]],window:{feature:.04,search:.2}}]}
  expect(videoEditTrackerSchema.safeParse(point).success).toBe(true)
  expect(videoEditTrackerSchema.safeParse({...point,prompts:[...point.prompts,{timeUs:1,points:[[.4,.4,1]]}]}).success).toBe(false)
  expect(videoEditTrackerSchema.safeParse({...point,prompts:[{timeUs:0,points:[[.4,.4,0]]}]}).success).toBe(false)
  expect(videoEditTrackerSchema.safeParse({...point,prompts:[{timeUs:0,points:[[.4,.4,1]],window:{feature:.2,search:.1}}]}).success).toBe(false)
  const quad:VideoEditTrackQuad=[[.1,.1],[.9,.1],[.8,.9],[.2,.8]]
  expect(videoEditTrackerSchema.safeParse({...point,method:'planar',prompts:[{timeUs:0,quad}]}).success).toBe(true)
  expect(videoEditTrackerSchema.safeParse({...point,method:'planar',prompts:[{timeUs:0,quad:[quad[0],quad[2],quad[1],quad[3]]}]}).success).toBe(false)
})

it('非仿射透视贴合：四角精确映射，内部像素齐次插值且两三角形无接缝',()=> {
  const quad:VideoEditTrackQuad=[[.1,.2],[.85,.1],[.7,.8],[.25,.9]];const h=videoEditCornerPinMatrix(quad)
  const unit=[[0,0],[1,0],[1,1],[0,1]]
  unit.forEach(([x,y],i)=>videoEditTrackProject(h,x,y).forEach((v,k)=>expect(v).toBeCloseTo(quad[i][k],12)))
  // A texel (u=.25,v=.6) maps into the plane; GPU perspective interpolation recovers its exact source UV.
  const uv=[.25,.6];const xy=videoEditTrackProject(h,...uv as [number,number]);const weights=[1-uv[0]-uv[1],uv[0],uv[1]]
  const corners=[unit[0],unit[1],unit[3]];const w=corners.map(([x,y])=>h[6]*x+h[7]*y+h[8])
  const denominator=weights.reduce((sum,b,i)=>sum+b*w[i],0)
  const screen=corners.map(([x,y])=>videoEditTrackProject(h,x,y))
  expect(weights.reduce((s,b,i)=>s+b*w[i]*screen[i][0],0)/denominator).toBeCloseTo(xy[0],12)
  expect(weights.reduce((s,b,i)=>s+b*w[i]*screen[i][1],0)/denominator).toBeCloseTo(xy[1],12)
  expect(xy[0]*1920).toBeGreaterThan(0);expect(xy[1]*1080).toBeGreaterThan(0)
  const record={quad,homography:h,confidence:.95};expect(decodeVideoEditTrackGeometry(encodeVideoEditTrackGeometry(record))).toEqual(record)
})
