import { ImageEditorRasterBrushOverlayV3 } from './ImageEditorRasterBrushOverlayV3';
import type { ToolOverlaySlot } from '../toolFramework/types';

/** Paint and retouch share one slot object, pointer binding, overlay and cancellation owner. */
export const rasterBrushToolSlotV3: ToolOverlaySlot = { id: 'raster', render: context => <ImageEditorRasterBrushOverlayV3 {...context} /> };
