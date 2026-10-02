import type { NativeMediaProbeOutcome, NativeVideoDecoderStatus } from '../../src/platform/contracts/videoDecoderTypes'

/** 原生视频解码服务的素材探测与状态（见 src/platform/contracts/videoDecoder.ts）。 */
export interface HenjiVideoDecoderApi {
  probe: (requestId: string, path: string) => Promise<NativeMediaProbeOutcome>
  cancelProbe: (requestId: string) => Promise<boolean>
  status: () => Promise<NativeVideoDecoderStatus>
}
