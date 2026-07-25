import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ImageEditorToolDefinition {
  id: string;
  label: string;
  operationId: string;
  icon: LucideIcon;
  inspector: ComponentType;
}
