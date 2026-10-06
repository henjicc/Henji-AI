import type { AudioLoudnessPlatform } from '../../src/platform/contracts/audioLoudness'

export function createAudioLoudnessApi(nativeInvoke: <T>(channel: string, payload?: unknown) => Promise<T>): AudioLoudnessPlatform {
  return {
    start: (sampleRate, channels, sessionId) => nativeInvoke('audio:loudness', { action: 'start', sampleRate, channels, sessionId }),
    append: (sessionId, channels) => nativeInvoke('audio:loudness', { action: 'append', sessionId, channels }),
    measure: sessionId => nativeInvoke('audio:loudness', { action: 'measure', sessionId }),
    normalize: (sessionId, settings) => nativeInvoke('audio:loudness', { action: 'normalize', sessionId, settings }),
    read: (sessionId, startFrame, frames) => nativeInvoke('audio:loudness', { action: 'read', sessionId, startFrame, frames }),
    close: sessionId => nativeInvoke('audio:loudness', { action: 'close', sessionId }),
  }
}
