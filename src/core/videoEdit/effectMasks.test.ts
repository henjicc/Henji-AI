import { describe, expect, it } from 'vitest'
import {
  affineVideoEditMaskShape, createVideoEditMaskShape, insertVideoEditMaskPoint, removeVideoEditMaskPoint, toggleVideoEditMaskPoint, VideoEditMaskRasterCache, editVideoEditMaskShape, fillVideoEditMaskPolygon, flattenVideoEditMaskPath, rasterizeVideoEditMaskShapes, transformVideoEditMaskShape,
  videoEditEffectMaskSchema, videoEditMaskShapeBounds, videoEditMaskShapePoints, type VideoEditMaskShape,
} from './effectMasks'
import { videoEditEffectSchema } from './compositing'
import { processSmartRegionMatte } from './smartRegions'
const rect = (id: string, x: number, y: number, w: number, h: number): VideoEditMaskShape => ({ id, kind: 'rect', points: [[x,y,0,0,0,0],[x+w,y,0,0,0,0],[x+w,y+h,0,0,0,0],[x,y+h,0,0,0,0]] })

const coverage = (mask: Uint8Array): number => mask.reduce((sum, value) => sum + value, 0) / 255

describe('作用区域：路径编辑与变换', () => {
  it('矩形拖角只移动一个顶点，平滑点的手柄偏移跟随；Alt 可打断单侧手柄', () => {
    const shape = createVideoEditMaskShape('rect','r')
    const moved = editVideoEditMaskShape(shape,'vertex',2,.2,.1,{u:.9,v:.8})
    expect(moved.points[2]).toEqual([expect.closeTo(.9),expect.closeTo(.8),0,0,0,0])
    expect(moved.points.filter((_,i)=>i!==2)).toEqual(shape.points.filter((_,i)=>i!==2))
    const smooth = createVideoEditMaskShape('ellipse','e')
    expect(editVideoEditMaskShape(smooth,'vertex',0,.1,.2,{u:0,v:0}).points[0].slice(2)).toEqual(smooth.points[0].slice(2))
    const broken = editVideoEditMaskShape(smooth,'out',0,0,0,{u:.8,v:.6},true)
    expect(broken.points[0].slice(2,4)).toEqual(smooth.points[0].slice(2,4))
    expect(broken.points[0].slice(4)).toEqual([expect.closeTo(.3),expect.closeTo(.3)])
    const symmetric = editVideoEditMaskShape(shape,'symmetric',0,0,0,{u:.4,v:.5})
    expect(symmetric.points[0].slice(2)).toEqual([expect.closeTo(-.1),expect.closeTo(-.2),expect.closeTo(.1),expect.closeTo(.2)])
  })
  it('Alt 转换沿前后点方向生成对称手柄，再转换恢复尖角；删除保留三个点', () => {
    const shape = createVideoEditMaskShape('rect','r')
    const smooth = toggleVideoEditMaskPoint(shape,0)
    expect(smooth.points[0][2]).toBeCloseTo(-smooth.points[0][4])
    expect(smooth.points[0][3]).toBeCloseTo(-smooth.points[0][5])
    expect(toggleVideoEditMaskPoint(smooth,0)).toEqual(shape)
    const triangle = removeVideoEditMaskPoint(shape,1)
    expect(triangle.points).toHaveLength(3)
    expect(()=>removeVideoEditMaskPoint(triangle,0)).toThrow('至少')
  })
  it('de Casteljau 插点保持整段曲线及两端外侧手柄（含闭合段）', () => {
    const original = createVideoEditMaskShape('ellipse','e')
    const split = .37
    const evaluate = (shape: VideoEditMaskShape, index: number, t: number): number[] => {
      const a = shape.points[index]; const b = shape.points[(index+1)%shape.points.length]; const u = 1-t
      return [0,1].map(axis => u*u*u*a[axis]+3*u*u*t*(a[axis]+a[axis+4])+3*u*t*t*(b[axis]+b[axis+2])+t*t*t*b[axis])
    }
    for (const index of [0,3]) {
      const inserted = insertVideoEditMaskPoint(original,index,split)
      expect(inserted.points).toHaveLength(5)
      expect(inserted.points[index].slice(2,4)).toEqual(original.points[index].slice(2,4))
      for (let step=0;step<=100;step++) {
        const t=step/100; const result=t<=split ? evaluate(inserted,index,t/split) : evaluate(inserted,index+1,(t-split)/(1-split))
        result.forEach((value,axis)=>expect(value).toBeCloseTo(evaluate(original,index,t)[axis],12))
      }
    }
  })
  it('仿射缩放、旋转、平移：顶点带平移，手柄保持向量；跟踪复用路径模型', () => {
    const shape = createVideoEditMaskShape('ellipse','e')
    const rotated = affineVideoEditMaskShape(shape,[0,2,-3,0,1,4])
    shape.points.forEach(([x,y,ix,iy,ox,oy],i)=>[1-3*y,4+2*x,-3*iy,2*ix,-3*oy,2*ox].forEach((value,at)=>expect(rotated.points[i][at]).toBeCloseTo(value,12)))
    const moved = transformVideoEditMaskShape(shape,{fromX:.5,fromY:.5,toX:.6,toY:.5,scale:2})
    expect(videoEditMaskShapeBounds(moved)).toEqual([expect.closeTo(.2),expect.closeTo(.1),expect.closeTo(.8),expect.closeTo(.8)])
    expect(videoEditMaskShapePoints(moved)).toHaveLength(4)
  })
  it('形状与顶点没有产品数量上限', () => {
    const shapes = Array.from({length:100},(_,i)=>createVideoEditMaskShape('rect',String(i)))
    shapes[0].points = Array.from({length:100},(_,i)=>[i/100,i%2,0,0,0,0])
    expect(videoEditEffectMaskSchema.parse({regionId:'shapes',shapes})).toMatchObject({shapes})
  })
  it('裁切栅格化与全幅处理逐像素一致：画面边缘、负扩展、羽化、反转、组合；缓存只复用几何', () => {
    const width=180; const height=100; const cache = new VideoEditMaskRasterCache()
    const source = createVideoEditMaskShape('ellipse','e')
    for (const expand of [-100,0,80]) for (const feather of [0,5,60,100]) for (const invert of [false,true]) {
      const shape = { ...affineVideoEditMaskShape(source,[1,0,0,1,-.4,-.2]),expand,feather,invert }
      const filled = fillVideoEditMaskPolygon(flattenVideoEditMaskPath(shape.points,width,height),width,height)
      const expected = processSmartRegionMatte(filled,width,height,{expand,feather,invert})
      expect(rasterizeVideoEditMaskShapes([shape],width,height,cache)).toEqual(expected)
      expect(rasterizeVideoEditMaskShapes([shape,{...source,opacity:70,mode:'subtract'}],width,height,cache)).toEqual(rasterizeVideoEditMaskShapes([shape,{...source,opacity:70,mode:'subtract'}],width,height))
    }
  })
})

describe('作用区域：存储格式', () => {
  it('智能区域与手绘遮罩按 regionId 区分；所有形状必须给 points，拒绝旧 box', () => {
    expect(videoEditEffectMaskSchema.parse({ regionId: 'face', feather: 10 })).toEqual({ regionId: 'face', feather: 10 })
    const shapes = { regionId: 'shapes', shapes: [{ ...createVideoEditMaskShape('ellipse','a'), mode: 'subtract', opacity: 50 }] }
    expect(videoEditEffectMaskSchema.parse(shapes)).toEqual(shapes)
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [{ id: 'a', kind: 'path', box: [0, 0, 1, 1] }] })).toThrow(/points/)
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [rect('a',0,0,1,1),rect('a',0,0,1,1)] })).toThrow(/重复/)
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [] })).toThrow()
    expect(() => videoEditEffectMaskSchema.parse({ regionId: 'sky' })).toThrow()
  })

  it('效果上的手绘遮罩随效果一起校验，只允许内置画面效果', () => {
    const effect = { id: 'e', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'shapes', shapes: [rect('s',0,0,.5,.5)] } }
    expect(videoEditEffectSchema.parse(effect).mask).toEqual(effect.mask)
    expect(() => videoEditEffectSchema.parse({ ...effect, builtin: { id: 'compressor', params: {} } })).toThrow(/作用区域/)
  })
})

describe('作用区域：手绘遮罩栅格化', () => {
  const W = 200; const H = 100
  it('矩形按像素精确覆盖（含半像素边）', () => {
    const mask = rasterizeVideoEditMaskShapes([{ ...rect('r',.1025,.2,.5,.5), feather: 0 }], W, H)
    expect(coverage(mask)).toBeCloseTo(100 * 50, -1)
    expect(mask[45 * W + 60]).toBe(255); expect(mask[5 * W + 5]).toBe(0)
    // 左边落在 20.5 像素：那一列覆盖一半
    expect(mask[45 * W + 20]).toBeGreaterThan(115); expect(mask[45 * W + 20]).toBeLessThan(140)
  })

  it('椭圆转成贝塞尔后面积 ≈ πab', () => {
    const mask = rasterizeVideoEditMaskShapes([{ ...affineVideoEditMaskShape(createVideoEditMaskShape('ellipse','e'),[1.25,0,0,2,-.125,-.5]), feather: 0 }], W, H)
    expect(coverage(mask) / (Math.PI * 50 * 40)).toBeCloseTo(1, 2)
  })

  it('模式按顺序合成：相加取并、相减挖掉、交叉取交；第一个是相减时从整个画面开始', () => {
    const left: VideoEditMaskShape = { ...rect('l',0,0,.6,1), feather: 0 }
    const right: VideoEditMaskShape = { ...rect('r',.4,0,.6,1), feather: 0 }
    expect(coverage(rasterizeVideoEditMaskShapes([left, right], W, H))).toBeCloseTo(W * H, -1)
    expect(coverage(rasterizeVideoEditMaskShapes([left, { ...right, mode: 'subtract' }], W, H))).toBeCloseTo(0.4 * W * H, -1)
    expect(coverage(rasterizeVideoEditMaskShapes([left, { ...right, mode: 'intersect' }], W, H))).toBeCloseTo(0.2 * W * H, -1)
    expect(coverage(rasterizeVideoEditMaskShapes([{ ...left, mode: 'subtract' }], W, H))).toBeCloseTo(0.4 * W * H, -1)
  })

  it('不透明度、反转、扩展、羽化', () => {
    const base: VideoEditMaskShape = { ...rect('b',.25,.25,.5,.5), feather: 0 }
    expect(rasterizeVideoEditMaskShapes([{ ...base, opacity: 50 }], W, H)[50 * W + 100]).toBe(128)
    const inverted = rasterizeVideoEditMaskShapes([{ ...base, invert: true }], W, H)
    expect(inverted[50 * W + 100]).toBe(0); expect(inverted[0]).toBe(255)
    // 扩展 100 = 画面高度 10% = 10 像素
    expect(coverage(rasterizeVideoEditMaskShapes([{ ...base, expand: 100 }], W, H))).toBeCloseTo(120 * 70, -2)
    const feathered = rasterizeVideoEditMaskShapes([{ ...base, feather: 60 }], W, H)
    expect(feathered[50 * W + 50]).toBeGreaterThan(40); expect(feathered[50 * W + 50]).toBeLessThan(215)
    expect(feathered[50 * W + 100]).toBe(255)
  })

  it('钢笔：尖角折线与带控制柄的曲线；自交路径按非零环绕填充', () => {
    const triangle = flattenVideoEditMaskPath([[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]], 10, 10)
    expect(Array.from(triangle)).toEqual([0, 0, 10, 0, 0, 10])
    expect(coverage(fillVideoEditMaskPolygon(triangle, 10, 10))).toBeCloseTo(50, 0)
    const curved = flattenVideoEditMaskPath([[0.5, 0, 0.3, 0, 0.3, 0], [1, 1, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]], 10, 10)
    expect(curved.length).toBeGreaterThan(6)
  })
})
