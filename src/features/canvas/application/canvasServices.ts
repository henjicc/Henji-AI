import { InMemoryCanvasEventBus } from './eventBus';
import { nodeCatalog } from './nodeCatalog';
import { CanvasNodeFactory } from './nodeFactory';
import { CanvasToolProcessor } from './toolProcessor';
import { uuidGenerator } from '../infrastructure/idGenerator';
import { imageSplitGateway } from '../infrastructure/imageSplitGateway';

export const canvasEventBus = new InMemoryCanvasEventBus();
export const canvasNodeFactory = new CanvasNodeFactory(uuidGenerator, nodeCatalog);
export const canvasToolProcessor = new CanvasToolProcessor(imageSplitGateway, uuidGenerator);
