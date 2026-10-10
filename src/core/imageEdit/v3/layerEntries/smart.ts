import type { z } from 'zod';
import { imageLayerSchema } from '../../../persistence/imageSchemas';
import type { ImageEditSmartLayerV3 } from '../smartContent/types';
import { collectImageEditJsonResourceIdsV3 } from '../resourceReferences';
import type { ImageEditLayerContentRegistryV3 } from '../layerModel/contentRegistry';

export function registerImageEditSmartContentV3(registry: ImageEditLayerContentRegistryV3): void {
  registry.register({ type: 'smart', schema: imageLayerSchema as z.ZodType<ImageEditSmartLayerV3>,
    resourceIds: layer => collectImageEditJsonResourceIdsV3(layer) });
}
