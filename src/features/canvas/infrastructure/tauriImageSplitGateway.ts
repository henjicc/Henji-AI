import { splitImageSource } from '@/commands/image';

import type { ImageSplitGateway } from '../application/ports';

export const tauriImageSplitGateway: ImageSplitGateway = {
  split: (imageSource, rows, cols, lineThickness) =>
    splitImageSource(imageSource, rows, cols, lineThickness),
};
