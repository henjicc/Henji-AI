import { imageEditLayerMaskTransformV3 } from '@/core/imageEdit/v3/renderContracts/maskTransform'
import {transformVectorPath} from '@/core/imaging/vectorContent'
import {invertImageEditTransformV3,multiplyImageEditTransformsV3} from '@/core/imageEdit/v3/execution/affineTransform'
import {createImageEditSparseMaskReferenceV3,type ImageEditTransformV3} from '@/core/imageEdit/v3/layerTypes'
import { requireImageEditDocumentInstanceV3 } from '../../application/imageEditDocumentInstances';
import { findImageEditLayerLocationV3 } from '../../editor/layerTreeV3';
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory';
import { parseImageEditVectorContentV3, isImageEditVectorLayerV3, type ImageEditVectorLayerV3 } from '@/core/imageEdit/v3/layerEntries/vector';
import type { ImageEditLeafCommandV3 } from '@/core/imageEdit/v3/commandTypes';

export function setImageEditVectorContentV3(documentId: string, layerId: string, content: unknown): void {
  const { bus } = requireImageEditDocumentInstanceV3(documentId);
  const document = bus.getSnapshot().document;
  const location = findImageEditLayerLocationV3(document.layers, layerId);
  if (!location || !isImageEditVectorLayerV3(location.layer)) throw new Error('请选择文字、形状或路径图层。');
  if (location.layer.locked || location.ancestors.some(layer => layer.locked)) throw new Error('请先解锁图层。');
  const parsed = parseImageEditVectorContentV3(location.layer.type, content);
  const layer = { ...location.layer, content: parsed } as ImageEditVectorLayerV3;
  bus.dispatch({ type: 'layer.replace', commandId: createImageEditIdV3('vector-content'), expectedRevision: document.revision, layerId, layer });
}
export function addImageEditVectorLayersV3(documentId: string, layers: readonly ImageEditVectorLayerV3[]): void {
  const { bus } = requireImageEditDocumentInstanceV3(documentId);
  const document = bus.getSnapshot().document;
  const commands = layers.map((layer, index): ImageEditLeafCommandV3 => ({ type: 'layer.add', commandId: createImageEditIdV3('vector-layer'), expectedRevision: document.revision, parentId: null, index: document.layers.length + index, layer }));
  if (!commands.length) return;
  bus.dispatch(commands.length === 1 ? commands[0] : { type: 'document.atomic', commandId: createImageEditIdV3('vector-group'), expectedRevision: document.revision, commands });
}

/** Keep editable path data in the target's object space, including nested-group transforms. */
export function attachImageEditVectorMaskV3(documentId:string,pathLayerId:string,targetLayerId:string):void {
  const {bus}=requireImageEditDocumentInstanceV3(documentId);
  const document=bus.getSnapshot().document;
  const source=findImageEditLayerLocationV3(document.layers,pathLayerId),target=findImageEditLayerLocationV3(document.layers,targetLayerId);
  if(!source || (source.layer.type!=='shape'&&source.layer.type!=='path'))throw new Error('请选择形状或路径图层');
  if(!target||target.layer.locked||target.ancestors.some(layer=>layer.locked))throw new Error('目标不存在或已锁定');
  const world=(location:NonNullable<typeof target>):ImageEditTransformV3=>[...location.ancestors,location.layer].reduce<ImageEditTransformV3>((matrix,layer)=>multiplyImageEditTransformsV3(matrix,layer.transform),[1,0,0,1,0,0]);
  const matrix=multiplyImageEditTransformsV3(invertImageEditTransformV3(multiplyImageEditTransformsV3(target.ancestors.reduce<ImageEditTransformV3>((matrix,layer)=>multiplyImageEditTransformsV3(matrix,layer.transform),[1,0,0,1,0,0]),imageEditLayerMaskTransformV3(target.layer))),world(source));
  const mask={...createImageEditSparseMaskReferenceV3(createImageEditIdV3('vector-mask'),false,0),vectorPaths:source.layer.content.operands.map(operand=>({...operand,path:transformVectorPath(operand.path,matrix)}))};
  bus.dispatch({type:'layer.set-mask',commandId:createImageEditIdV3('vector-mask'),expectedRevision:document.revision,layerId:targetLayerId,mask});
}
