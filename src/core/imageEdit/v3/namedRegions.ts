import { z } from 'zod';
import { imageEditSelectionSessionSchemaV3 } from './selection/session';

/** 命名 Alpha 通道保留区域意图；使用共享区域核求值，不量化为灰度预览。 */
export const imageEditNamedRegionSchemaV3 = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  selection: imageEditSelectionSessionSchemaV3,
}).strict();
export const imageEditNamedRegionsSchemaV3 = z.array(imageEditNamedRegionSchemaV3)
  .refine(regions => new Set(regions.map(region => region.id)).size === regions.length, '通道标识必须唯一');
export type ImageEditNamedRegionV3 = z.infer<typeof imageEditNamedRegionSchemaV3>;
