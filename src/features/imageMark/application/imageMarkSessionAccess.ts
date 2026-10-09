import { getImageEditDocumentCatalogRevisionV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'

/** 标注与图层共用 V3 文档目录的并发基线。 */
export function imageMarkRevision(): number { return getImageEditDocumentCatalogRevisionV3() }
