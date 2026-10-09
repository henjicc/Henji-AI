import type { ImageEditorV3SubjectRequest, ImageEditorV3SubjectResult } from '../../../../../src/platform/contracts/imageEditorV3'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider } from '../providers'

export interface ImageSubjectSelectionJob extends Omit<ImageEditorV3SubjectRequest, 'requestId'> {
  id: string
  models: LocalInferenceModelFile[]
  providers: LocalExecutionProvider[]
}
export type ImageSubjectSelectionResult = ImageEditorV3SubjectResult
