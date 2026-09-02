import {
  ImageEditTaskCancelledError,
  ImageEditTaskSupersededError,
} from '@/core/imageEdit/v3/renderScheduler'
import {
  ImageEditorViewportCompositeSupersededErrorV3,
} from './viewportCompositeTypesV3'

export const IMAGE_EDITOR_VIEWPORT_MAX_TRANSFER_BYTES_V3 = 256 * 1024 * 1024
export const IMAGE_EDITOR_VIEWPORT_CANCEL_ACK_TIMEOUT_MS_V3 = 50

export function imageEditorViewportErrorV3(error: unknown): Error {
  if (error instanceof ImageEditTaskSupersededError
    || error instanceof ImageEditTaskCancelledError) {
    return new ImageEditorViewportCompositeSupersededErrorV3()
  }
  return error instanceof Error ? error : new Error(String(error))
}
