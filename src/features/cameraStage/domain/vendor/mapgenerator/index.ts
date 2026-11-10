/*
 * 张量场路网生成，移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，
 * 提交 f487e4cee321d105d5b0e14258363fa8b4d004ef），按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 * 本目录是独立可替换的模块：布景只经这个入口调用，换成别的实现或修改后的版本只需保持这里的导出不变。
 *
 * 本文件对应原 src/ts/ui/main_gui.ts 里的生成顺序（河流 → 主干道 → 次干道 → 公园 → 支路，后一级避开前一级）。
 * 2026-11-04 痕迹AI 的修改：去掉界面、动画与绘制，只留生成顺序；参数由调用方按米给出；公园多边形由调用方给
 * （原为在次干道围出的多边形里随机挑，需要 jsts，这里不移植）；随机数由调用方传入；可选给道路加全局旋转噪声。
 */

import { RK4Integrator } from './integrator'
import StreamlineGenerator, { type StreamlineParams } from './streamlines'
import TensorField, { type NoiseParams } from './tensor_field'
import Vector from './vector'
import WaterGenerator, { type WaterParams } from './water_generator'

export { TensorField, Vector }
export type { NoiseParams, StreamlineParams }

export interface RoadNetworkParams {
  main: StreamlineParams
  major: StreamlineParams
  minor: StreamlineParams
  /** 不要河流时为 null */
  water: WaterParams | null
  /** 积分道路时的全局旋转噪声（角度为度）；null 为不加。原程序只在积分河流与海岸时加全局噪声 */
  roadNoise: { size: number; angle: number } | null
}

export interface RiverResult {
  /** 中心线 */
  centerline: Vector[]
  /** 水面轮廓 */
  polygon: Vector[]
  /** 两岸沿河路，按次干道处理 */
  bankRoads: Vector[][]
}

/**
 * 一片矩形范围（origin 起、宽高 dimensions）里的路网。各级道路都是简化后的折线。
 * 先调 generateTrunk（河流、主干道、次干道），挑好公园后再调 generateMinor。
 */
export class RoadNetwork {
  river: RiverResult | null = null
  mainRoads: Vector[][] = []
  majorRoads: Vector[][] = []
  minorRoads: Vector[][] = []

  private water: WaterGenerator | null = null
  private main: StreamlineGenerator | null = null
  private major: StreamlineGenerator | null = null

  constructor(
    private field: TensorField,
    private origin: Vector,
    private dimensions: Vector,
    private params: RoadNetworkParams,
    private random: () => number,
  ) {}

  /** 河流（可选）、主干道、次干道。主次干道可以跨河（桥），支路不过河。 */
  generateTrunk(): void {
    if (this.params.water) {
      const integrator = new RK4Integrator(this.field, this.params.water.dstep)
      const water = new WaterGenerator(integrator, this.origin, this.dimensions, { ...this.params.water }, this.field, this.random)
      // 河流沿次方向走，沿河路与主干道同向，原程序也是这样取向
      if (water.createRiver(false)) {
        this.water = water
        this.river = { centerline: water.river, polygon: water.riverPolygon, bankRoads: water.bankRoads }
      }
    }
    if (this.params.roadNoise) this.field.enableGlobalNoise(this.params.roadNoise.angle, this.params.roadNoise.size)
    this.field.ignoreRiver = true
    this.main = this.streamlines(this.params.main, this.water ? [this.water] : [])
    this.mainRoads = this.main.allStreamlinesSimple
    this.major = this.streamlines(this.params.major, [...(this.water ? [this.water] : []), this.main])
    this.majorRoads = this.major.allStreamlinesSimple
    this.field.ignoreRiver = false
  }

  /** 支路：公园里加旋转噪声，弯成园路。 */
  generateMinor(parks: Vector[][]): void {
    this.field.parks = parks
    const existing = [...(this.water ? [this.water] : []), ...(this.main ? [this.main] : []), ...(this.major ? [this.major] : [])]
    this.minorRoads = this.streamlines(this.params.minor, existing).allStreamlinesSimple
  }

  private streamlines(params: StreamlineParams, existing: readonly StreamlineGenerator[]): StreamlineGenerator {
    const integrator = new RK4Integrator(this.field, params.dstep)
    const generator = new StreamlineGenerator(integrator, this.origin, this.dimensions, { ...params }, this.random)
    for (const other of existing) generator.addExistingStreamlines(other)
    generator.createAllStreamlines()
    return generator
  }
}
