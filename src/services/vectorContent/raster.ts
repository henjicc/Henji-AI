import { layoutRichText, richTextContentSchema, vectorPathContentSchema, rasterizeVectorCoverage, traceVectorPath, type VectorEvaluationContext, type RichTextContent, type VectorPathContent } from '@/core/imaging/vectorContent';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import { paintText } from './textRaster';
import { paintVectorAppearance } from './appearance';
import { filterCoverage } from '@/core/imaging/regions/selectionAlgorithms/modify';

export type VectorRasterContent = { type: 'text'; content: RichTextContent } | { type: 'shape' | 'path'; content: VectorPathContent };
export interface VectorRasterRegion { x: number; y: number; width: number; height: number; scale: number }
/** Host raster adapter: only the requested ROI is allocated. Every image output uses this entry. */
function renderVectorContent(value: unknown, region: VectorRasterRegion, evaluation: VectorEvaluationContext): ImageData {
  evaluation.signal?.throwIfAborted();
  const candidate = value as Partial<VectorRasterContent>;
  if (!candidate || !['text', 'shape', 'path'].includes(candidate.type ?? '')) throw new Error('矢量内容类型无效。');
  const canvas = new OffscreenCanvas(region.width, region.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建文字与路径绘制上下文。');
  const { scale } = region;
  context.scale(scale, scale);
  const origin = { x: region.x / scale, y: region.y / scale };
  if (candidate.type === 'text') {
    const content = richTextContentSchema.parse(candidate.content);
    const layout = layoutRichText(content, (text, font) => { context.font = font; return context.measureText(text).width; }, evaluation);
    for (const run of layout.runs) {
      evaluation.signal?.throwIfAborted();
      const width = region.width / scale, height = region.height / scale;
      context.direction = run.direction === 'auto' ? 'inherit' : run.direction;
      const style = { ...run.style, align: 'left' as const, verticalAlign: 'top' as const, boxWidth: 0, boxHeight: 0 };
      paintText(context, { text: run.text, textStyle: style }, width, height, undefined,
        { lines: [run.text], left: run.x - origin.x, top: run.y - origin.y, contentTop: run.y - origin.y, width: run.width, height: run.lineHeight, lineHeight: run.lineHeight, style }, scale);
    }
  } else {
    const content = vectorPathContentSchema.parse(candidate.content);
    const { paint } = content;
    const drawCoverage = (target: OffscreenCanvasRenderingContext2D): void => {
      const coverage = rasterizeVectorCoverage(content.operands, region, scale, scale, evaluation.signal);
      const image = new ImageData(region.width, region.height);
      for(let i=0;i<coverage.length;i++){image.data[i*4]=255;image.data[i*4+1]=255;image.data[i*4+2]=255;image.data[i*4+3]=Math.round(coverage[i]*255);}
      target.save();target.resetTransform();target.putImageData(image,0,0);target.restore();
    };
    const drawOutline = (target: OffscreenCanvasRenderingContext2D, radius: number): void => {
      target.save();
      if (content.operands.length <= 1) {
        target.translate(-origin.x, -origin.y); target.lineWidth = radius * 2; target.strokeStyle = WHITE_HEX; target.lineJoin = 'round'; target.lineCap = 'round';
        for (const operand of content.operands) { target.beginPath(); traceVectorPath(target, operand.path); target.stroke(); }
      } else {
        const mask = new OffscreenCanvas(region.width, region.height), probe = mask.getContext('2d')!;
        probe.scale(scale, scale); drawCoverage(probe);
        const image = probe.getImageData(0, 0, mask.width, mask.height), data = new Float32Array(mask.width * mask.height);
        for (let i = 0; i < data.length; i++) data[i] = image.data[i * 4 + 3] / 255;
        const expansion = filterCoverage(data, mask.width, mask.height, Math.ceil(radius * scale), 'max');
        const contraction = filterCoverage(data, mask.width, mask.height, Math.ceil(radius * scale), 'min');
        for (let i = 0; i < data.length; i++) { image.data[i * 4] = 255; image.data[i * 4 + 1] = 255; image.data[i * 4 + 2] = 255; image.data[i * 4 + 3] = Math.round((expansion[i] - contraction[i]) * 255); }
        target.resetTransform(); target.putImageData(image, 0, 0);
      }
      target.restore();
    };
    paintVectorAppearance(context, region.width / scale, region.height / scale, scale, paint, drawCoverage, drawOutline);
  }
  evaluation.signal?.throwIfAborted();
  return context.getImageData(0, 0, region.width, region.height);
}

/** Render with a halo so outlines and shadows crossing an ROI edge remain continuous. */
export function rasterizeVectorContent(value: unknown, region: VectorRasterRegion, evaluation: VectorEvaluationContext): ImageData {
  if (!Number.isFinite(region.scale) || region.scale <= 0) throw new Error('矢量栅格比例无效。');
  const candidate = value as Partial<VectorRasterContent>;
  const paints = candidate?.type === 'text' ? richTextContentSchema.parse(candidate.content).paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.style)) : [vectorPathContentSchema.parse(candidate?.content).paint];
  let extent = 2;
  for (const paint of paints) {
    for (const stroke of paint.strokes) if (stroke.enabled) extent = Math.max(extent, stroke.width);
    const strokeExtent=Math.max(0,...paint.strokes.filter(stroke=>stroke.enabled).map(stroke=>stroke.width));
    for (const shadow of paint.shadows) if (shadow.enabled) extent = Math.max(extent, shadow.distance + strokeExtent + shadow.size + shadow.blur * 3);
  }
  const halo = Math.ceil(extent * region.scale);
  // Native Canvas surfaces and the shared worker memory budget are finite; logical content has no count limit.
  if((region.width+halo*2)*(region.height+halo*2)>16*1024*1024)throw new Error('描边或阴影超出当前分块的绘制内存预算，请缩小外观范围后重试。');
  const expanded = renderVectorContent(value, { ...region, x: region.x - halo, y: region.y - halo, width: region.width + halo * 2, height: region.height + halo * 2 }, evaluation);
  const output = new ImageData(region.width, region.height);
  for (let y = 0; y < region.height; y++) output.data.set(expanded.data.subarray(((y + halo) * expanded.width + halo) * 4, ((y + halo) * expanded.width + halo + region.width) * 4), y * region.width * 4);
  return output;
}
