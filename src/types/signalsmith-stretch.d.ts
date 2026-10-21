/** Raw Emscripten factory exposed by `patches/signalsmith-stretch+1.3.2.patch` (the package only exports an AudioWorklet node). */
declare module 'signalsmith-stretch' {
  export interface SignalsmithStretchModule {
    readonly HEAP8: Int8Array
    _main?(): void
    _presetDefault(channels: number, sampleRate: number): void
    _presetCheaper(channels: number, sampleRate: number): void
    _configure(channels: number, blockSamples: number, intervalSamples: number, splitComputation: boolean): void
    _reset(): void
    _inputLatency(): number
    _outputLatency(): number
    _blockSamples(): number
    _intervalSamples(): number
    /** Allocates `channels` input then `channels` output planes of `length` float samples; returns the first plane's byte offset. */
    _setBuffers(channels: number, length: number): number
    _setTransposeFactor(factor: number, tonalityLimit: number): void
    _setTransposeSemitones(semitones: number, tonalityLimit: number): void
    _setFormantFactor(factor: number, compensatePitch: boolean): void
    _setFormantSemitones(semitones: number, compensatePitch: boolean): void
    _setFormantBase(baseFrequency: number): void
    /** Previous input ending at the new input position (no output); `playbackRate` = input samples per output sample. */
    _seek(inputSamples: number, playbackRate: number): void
    /** Consumes `inputSamples` from the input planes and writes `outputSamples` to the output planes; the ratio sets the speed. */
    _process(inputSamples: number, outputSamples: number): void
    _flush(outputSamples: number): void
  }
  export function SignalsmithStretchWasm(options?: Record<string, unknown>): Promise<SignalsmithStretchModule>
  const createStretchNode: (audioContext: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<AudioWorkletNode>
  export default createStretchNode
}
