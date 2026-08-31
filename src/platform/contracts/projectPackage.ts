import type { ImageEditProjectPackageReferenceMappingV3 } from '@/core/imageEdit/v3/projectPackageContracts'

export interface PackageMediaFile {
  srcPath: string
  packagePath: string
}

export interface ImportedProjectPackage {
  manifestJson: string
  /** 包内路径（media/xxx.ext）-> 解压后的本地绝对路径 */
  pathMap: Record<string, string>
  /** 跨机器导入后，包内 V3 文档引用到本机新文档引用的完整映射。 */
  imageEditReferences: ImageEditProjectPackageReferenceMappingV3[]
}

export interface ProjectPackagePlatform {
  exportProjectPackage(
    manifestJson: string,
    mediaFiles: PackageMediaFile[],
    targetPath: string
  ): Promise<void>
  importProjectPackage(zipPath: string): Promise<ImportedProjectPackage>
}
