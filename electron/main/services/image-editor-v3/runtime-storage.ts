import path from 'node:path'

import { getProgramStoreDir } from '../appPaths'

export interface ImageEditorV3StoragePaths {
  rootDir: string
  documentsDir: string
  resourcesDir: string
  materializationsDir: string
}

/** 图片编辑 V3 权威持久层的唯一目录契约，IPC 与项目包适配器必须共享；属于程序内部存储。 */
export function getImageEditorV3StoragePaths(rootDir = getProgramStoreDir('imageEditor')): ImageEditorV3StoragePaths {
  return {
    rootDir,
    documentsDir: path.join(rootDir, 'documents'),
    resourcesDir: path.join(rootDir, 'resources'),
    materializationsDir: path.join(rootDir, 'materializations'),
  }
}
