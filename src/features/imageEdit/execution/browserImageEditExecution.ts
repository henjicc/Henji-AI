import {
  createImageEditExecutionPort,
  imageEditDocumentToMarkDoc,
  imageEditOperationRegistry,
  type ImageEditDocument,
} from '@/core/imageEdit';
import { exportMarkedImage } from '@/features/imageMark/render/exportMarkedImage';

export const browserImageEditExecutionPort = createImageEditExecutionPort(
  imageEditOperationRegistry,
  {
    id: 'browser-canvas',
    execute: async ({ sourceImageUrl, document }): Promise<string> =>
      await exportMarkedImage(sourceImageUrl, imageEditDocumentToMarkDoc(document)),
  }
);

export async function exportImageEditDocument(
  sourceImageUrl: string,
  document: ImageEditDocument
): Promise<string> {
  const result = await browserImageEditExecutionPort.execute({ sourceImageUrl, document });
  return result.outputImageUrl;
}
