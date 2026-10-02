/** 原生视频解码服务的渲染层平台接口：素材探测与状态。数据契约见 `videoDecoderTypes.ts`。 */

export * from './videoDecoderTypes'
import type { NativeMediaProbeOutcome, NativeVideoDecoderStatus } from './videoDecoderTypes'

export interface VideoDecoderPlatform {
  /** 探测本地文件（绝对路径，所在目录须已授权读取）。服务故障不抛错，返回 `unavailable`；中止时拒绝。 */
  probe(path: string, signal?: AbortSignal): Promise<NativeMediaProbeOutcome>
  status(): Promise<NativeVideoDecoderStatus>
}
