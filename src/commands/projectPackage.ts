import { getPlatform } from '@/platform/runtime';
import type { ImageEditProjectPackageReferenceMappingV3 } from '@/core/imageEdit/v3/projectPackageContracts';

export interface PackageMediaFile {
  srcPath: string;
  packagePath: string;
}

export interface ImportedProjectPackage {
  manifestJson: string;
  /** 包内路径（media/xxx.ext）-> 解压后的本地绝对路径 */
  pathMap: Record<string, string>;
  imageEditReferences: ImageEditProjectPackageReferenceMappingV3[];
}

export async function exportProjectPackage(
  manifestJson: string,
  mediaFiles: PackageMediaFile[],
  targetPath: string
): Promise<void> {
  await getPlatform().projectPackage.exportProjectPackage(manifestJson, mediaFiles, targetPath);
}

export async function importProjectPackage(zipPath: string): Promise<ImportedProjectPackage> {
  return await getPlatform().projectPackage.importProjectPackage(zipPath);
}
