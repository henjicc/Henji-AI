import type { VideoEditBuiltinParams } from '../../../videoEdit/builtinEffects'
import { dbToGain, SmoothedValue, type AudioProcessor } from './shared'

/** 立体声与声道类效果：立体声扩展（中侧处理）、反相。 */

// —— 立体声扩展：M = (L+R)/2、S = (L-R)/2，侧声道乘宽度、中置乘中置增益（逐样本平滑）；单声道素材原样 ——
export class StereoWidth implements AudioProcessor {
  readonly latency = 0
  private readonly side: SmoothedValue; private readonly mid: SmoothedValue
  constructor(rate: number) { this.side = new SmoothedValue(rate); this.mid = new SmoothedValue(rate) }
  update(params: VideoEditBuiltinParams): void { this.side.set((params.width as number) / 100); this.mid.set(dbToGain(params.center as number)) }
  process(channels: Float32Array[], length: number): void {
    if (channels.length !== 2) return
    const [left, right] = channels
    for (let index = 0; index < length; index++) {
      const side = this.side.next(); const mid = this.mid.next()
      // 宽度 100、中置 0 dB 时不做运算（M/S 往返有舍入），逐样本原样。
      if (side === 1 && mid === 1) continue
      const m = (left[index] + right[index]) / 2 * mid; const s = (left[index] - right[index]) / 2 * side
      left[index] = m + s; right[index] = m - s
    }
  }
}
