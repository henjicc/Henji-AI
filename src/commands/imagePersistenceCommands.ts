import { getPlatform } from '@/platform/runtime'
import {
  appLocalDataDir,
  downloadDir,
  join,
  mkdir,
  writeFile,
} from '@/platform/desktopApi'
import { fileToDataUrl } from '@/utils/save'
import type { PersistImageSourceTrackedResult } from '@/platform/contracts/image'
import {
  embedPanoramaImageMetadata,
  readStoryboardImageMetadata,
} from './imageStoryboardCommands'
import {
  ensurePathWritable,
  extensionToMime,
  imageCmdWarn,
  isDataUrl,
  isLikelyLocalPath,
  isNativeImageRuntime,
  mimeToExtension,
  normalizeErrorMessage,
  normalizeLocalPath,
  normalizeSourceKey,
  persistBytes,
  persistDataUrl,
  resolveSafeFilename,
  sourceKindForLog,
  sourceToBytes,
  sourceToDataUrl,
  storyboardMetadataStore,
  throwNativeImageFailure,
} from './imageCommandShared'

export async function loadImage(filePath: string): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.loadImage(filePath);
    } catch (error) {
      throwNativeImageFailure('loadImage', startedAt, error, {
        sourceKind: sourceKindForLog(filePath),
      });
    }
  }
  return await fileToDataUrl(normalizeLocalPath(filePath));
}

export async function persistImageSource(source: string): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.persistImageSource(source);
    } catch (error) {
      throwNativeImageFailure('persistImageSource', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }

  if (isLikelyLocalPath(source)) {
    return normalizeLocalPath(source);
  }

  if (isDataUrl(source)) {
    return await persistDataUrl(source);
  }

  const { bytes, mime } = await sourceToBytes(source);
  return await persistBytes(bytes, mime);
}

export async function persistImageSourceTracked(
  source: string,
): Promise<PersistImageSourceTrackedResult> {
  const startedAt = performance.now()
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.persistImageSourceTracked(source)
    } catch (error) {
      throwNativeImageFailure('persistImageSourceTracked', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      })
    }
  }

  return {
    imagePath: await persistImageSource(source),
    createdFilePaths: [],
  }
}

export async function persistImageBinary(
  bytes: Uint8Array,
  extension = 'png'
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.persistImageBinary(bytes, extension);
    } catch (error) {
      throwNativeImageFailure('persistImageBinary', startedAt, error, {
        byteLength: bytes.byteLength,
        extension,
      });
    }
  }
  return await persistBytes(bytes, extensionToMime(extension));
}

export async function saveImageSourceToDownloads(
  source: string,
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToDownloads(source, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToDownloads', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        suggestedFileName,
      });
    }
  }

  try {
    const dir = await downloadDir();
    return await saveImageSourceToDirectory(source, dir, suggestedFileName);
  } catch {
    const appDir = await appLocalDataDir();
    const fallbackDir = await join(appDir, 'Henji-AI', 'Downloads');
    return await saveImageSourceToDirectory(source, fallbackDir, suggestedFileName);
  }
}

export async function saveImageSourceToPath(
  source: string,
  targetPath: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToPath(source, targetPath);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToPath', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }

  const { bytes } = await sourceToBytes(source);
  await ensurePathWritable(targetPath);
  await writeFile(targetPath, bytes);

  const metadata = await readStoryboardImageMetadata(source);
  if (metadata) {
    storyboardMetadataStore.set(normalizeSourceKey(targetPath), metadata);
  }

  return targetPath;
}

export async function savePanoramaImageSourceToPath(
  source: string,
  targetPath: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.savePanoramaImageSourceToPath(source, targetPath);
    } catch (error) {
      throwNativeImageFailure('savePanoramaImageSourceToPath', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }
  const embedded = await embedPanoramaImageMetadata(source);
  return await saveImageSourceToPath(embedded.imagePath, targetPath);
}

export async function saveImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToDirectory(source, targetDir, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToDirectory', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        suggestedFileName,
      });
    }
  }

  const { bytes, mime } = await sourceToBytes(source);
  await mkdir(targetDir, { recursive: true });

  const extension = mimeToExtension(mime);
  const base = resolveSafeFilename((suggestedFileName || `image-${Date.now()}`).replace(/\.[^.]+$/, ''));
  const targetPath = await join(targetDir, `${base}.${extension}`);
  await writeFile(targetPath, bytes);

  const metadata = await readStoryboardImageMetadata(source);
  if (metadata) {
    storyboardMetadataStore.set(normalizeSourceKey(targetPath), metadata);
  }

  return targetPath;
}

export async function savePanoramaImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.savePanoramaImageSourceToDirectory(source, targetDir, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('savePanoramaImageSourceToDirectory', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        suggestedFileName,
      });
    }
  }
  const embedded = await embedPanoramaImageMetadata(source);
  return await saveImageSourceToDirectory(embedded.imagePath, targetDir, suggestedFileName);
}

export async function saveImageSourceToAppDebugDir(
  source: string,
  category = 'grid',
  suggestedFileName?: string
): Promise<string> {
  const startedAt = performance.now();
  if (isNativeImageRuntime()) {
    try {
      return await getPlatform().image.saveImageSourceToAppDebugDir(source, category, suggestedFileName);
    } catch (error) {
      throwNativeImageFailure('saveImageSourceToAppDebugDir', startedAt, error, {
        sourceKind: sourceKindForLog(source),
        category,
        suggestedFileName,
      });
    }
  }

  const appDir = await appLocalDataDir();
  const debugDir = await join(appDir, 'Henji-AI', 'debug', category || 'grid');
  return await saveImageSourceToDirectory(source, debugDir, suggestedFileName);
}

export async function copyImageSourceToClipboard(source: string): Promise<void> {
  const startedAt = performance.now();
  try {
    await getPlatform().clipboard.writeImageFromSource(source);
    return;
  } catch (error) {
    if (!isNativeImageRuntime()) {
      imageCmdWarn('copyImageSourceToClipboard native-unavailable -> web fallback', {
        runtime: 'web',
        error: normalizeErrorMessage(error),
      });
    }
  }

  const localPath = await persistImageSource(source);

  if (isNativeImageRuntime()) {
    try {
      await getPlatform().clipboard.writeImageFromPath(localPath);
      return;
    } catch (error) {
      throwNativeImageFailure('copyImageSourceToClipboard', startedAt, error, {
        sourceKind: sourceKindForLog(source),
      });
    }
  }

  const dataUrl = await sourceToDataUrl(localPath);
  const blob = await (await fetch(dataUrl)).blob();
  if (!('clipboard' in navigator) || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持图片复制');
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}
