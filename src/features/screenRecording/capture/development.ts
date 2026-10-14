import { prepareScreenCapture, type ScreenCaptureSession } from './session'
import { captureOptionsSchema, type CaptureManifest, type ScreenCaptureOptions } from '@/core/screenRecording/capture'

/** Development bundle only. No alternate recorder; the isolated tour calls the formal service. */
export function installCaptureInspection(): void {
  let current: ScreenCaptureSession | null = null
  const host = window as unknown as { __henjiCapture?: { prepare(id: string, options: ScreenCaptureOptions): Promise<void>; read(): Promise<CaptureManifest | undefined>; close(): Promise<void> } }
  host.__henjiCapture = {
    prepare: async (id, options) => { current = await prepareScreenCapture(id, captureOptionsSchema.parse(options)) },
    read: async () => current?.read(),
    close: async () => { await current?.close(); current = null },
  }
}
