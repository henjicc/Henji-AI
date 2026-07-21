export interface PackageMediaFile {
  srcPath: string
  packagePath: string
}

export interface ImportedProjectPackage {
  manifestJson: string
  /** 包内路径（media/xxx.ext）-> 解压后的本地绝对路径 */
  pathMap: Record<string, string>
}

export interface ProjectPackagePlatform {
  exportProjectPackage(
    manifestJson: string,
    mediaFiles: PackageMediaFile[],
    targetPath: string
  ): Promise<void>
  importProjectPackage(zipPath: string): Promise<ImportedProjectPackage>
}
