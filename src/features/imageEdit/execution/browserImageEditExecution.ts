import {
  createImageEditExecutionPort,
  imageEditDocumentToMarkDoc,
  imageEditOperationRegistry,
  IMAGE_EDIT_OPERATION_IDS,
  type ImageEditDocument,
} from '@/core/imageEdit';
import { exportMarkedImage } from '@/features/imageMark/render/exportMarkedImage';
import { persistImageBinary } from '@/commands/image';
import { imageEditExecutionPort } from './imageEditExecution';

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
  const hasDiffusion = document.operations.some((operation) =>
    operation.enabled && operation.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion
  );
  if (hasDiffusion) {
    const result = await imageEditExecutionPort.execute({
      sourceImageUrl,
      document,
      purpose: 'export',
      quality: 'high',
      format: 'image/png',
    });
    if (result.kind !== 'encoded-export') {
      throw new Error('柔光导出未返回编码结果');
    }
    if (result.output.kind === 'url') return result.output.url;
    return await persistImageBinary(
      result.output.bytes,
      extensionFromFormat(result.output.format)
    );
  }
  const result = await browserImageEditExecutionPort.execute({ sourceImageUrl, document });
  if (result.kind !== 'encoded-export' || result.output.kind !== 'url') {
    throw new Error('浏览器图片编辑兼容执行器未返回图片 URL');
  }
  return result.output.url;
}

function extensionFromFormat(format: 'image/png' | 'image/jpeg' | 'image/webp'): string {
  if (format === 'image/jpeg') return 'jpg';
  if (format === 'image/webp') return 'webp';
  return 'png';
}
