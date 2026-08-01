import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { z } from 'zod';

import type { ImageEditControlOperation } from '../application/imageEditControlCatalog';

export interface ImageEditorToolDefinition {
  id: string;
  label: string;
  operationId: string;
  control: {
    operationSchema: z.ZodType<ImageEditControlOperation>;
    kinds: readonly ImageEditControlOperation['kind'][];
  };
  icon: LucideIcon;
  inspector: ComponentType;
}
