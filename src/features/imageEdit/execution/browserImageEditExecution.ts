import {
  createImageEditExecutionPort,
  imageEditDocumentToMarkDoc,
  imageEditOperationRegistry,
  IMAGE_EDIT_OPERATION_IDS,
  type ImageEditDocument,
} from '@/core/imageEdit';
import { exportMarkedImage } from '@/features/imageMark/render/exportMarkedImage';

export const browserImageEditExecutionPort = createImageEditExecutionPort(
  imageEditOperationRegistry,
  {
    id: 'browser-canvas',
    supportedOperationIds: [
      IMAGE_EDIT_OPERATION_IDS.orientation,
      IMAGE_EDIT_OPERATION_IDS.annotations,
      IMAGE_EDIT_OPERATION_IDS.crop,
    ],
    execute: async ({ sourceImageUrl, document }): Promise<string> =>
      await exportBrowserDocument(sourceImageUrl, document),
  }
);

async function exportBrowserDocument(sourceImageUrl: string, document: ImageEditDocument): Promise<string> {
  if (document.operations.some((operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion && operation.enabled)) {
    throw new Error('当前运行环境尚未提供柔光原生执行器');
  }
  return await exportMarkedImage(sourceImageUrl, imageEditDocumentToMarkDoc(document));
}

export async function exportImageEditDocument(
  sourceImageUrl: string,
  document: ImageEditDocument
): Promise<string> {
  const result = await browserImageEditExecutionPort.execute({ sourceImageUrl, document });
  return result.outputImageUrl;
}
