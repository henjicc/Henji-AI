import type { NativeMediaProbeOutcome, NativeVideoDecoderStatus } from '../../src/platform/contracts/videoDecoderTypes'
import type { HenjiVideoDecoderApi } from './api-video-decoder'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>

export function createVideoDecoderApi(nativeInvoke: NativeInvoke): HenjiVideoDecoderApi {
  return {
    probe: (requestId, path) => nativeInvoke<NativeMediaProbeOutcome>('videoDecoder:probe', { requestId, path }),
    cancelProbe: (requestId) => nativeInvoke<boolean>('videoDecoder:cancelProbe', { requestId }),
    status: () => nativeInvoke<NativeVideoDecoderStatus>('videoDecoder:status'),
  }
}
