import { invoke } from '@tauri-apps/api/core';

export interface PackageMediaFile {
  srcPath: string;
  packagePath: string;
}

export interface ImportedProjectPackage {
  manifestJson: string;
  /** 包内路径（media/xxx.ext）-> 解压后的本地绝对路径 */
  pathMap: Record<string, string>;
}

export async function exportProjectPackage(
  manifestJson: string,
  mediaFiles: PackageMediaFile[],
  targetPath: string
): Promise<void> {
  await invoke('export_project_package', { manifestJson, mediaFiles, targetPath });
}

export async function importProjectPackage(zipPath: string): Promise<ImportedProjectPackage> {
  return await invoke<ImportedProjectPackage>('import_project_package', { zipPath });
}
