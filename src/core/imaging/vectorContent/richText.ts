import type { RichTextContent, TextRun, TextParagraph, VectorEvaluationContext } from './contracts';
import { textWidth } from './metrics';
import type { TextStyle } from './text';
import { throwIfRegionAborted } from '../regions';

export interface PositionedTextRun extends TextRun { x: number; y: number; width: number; lineHeight: number; direction: 'auto' | 'ltr' | 'rtl' }
export interface RichTextLayout { runs: PositionedTextRun[]; lines: Array<{text:string;y:number;width:number;lineHeight:number}>; width: number; height: number }
export type TextMeasure = (text: string, font: string) => number;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export interface RichTextFlowLine { text: string; y: number; width: number; lineHeight: number; runs: TextRun[]; paragraph: TextParagraph; last: boolean }
export interface RichTextFlow { lines: RichTextFlowLine[]; width: number; height: number; originY: number }
export interface RichTextPositionPlan extends RichTextLayout { contentTop: number; rowRuns: PositionedTextRun[][] }

/** 换行只确定行与原始 run；定位由共享计划完成，fit 候选无需创建绘制坐标。 */
export function layoutRichTextFlow(content: RichTextContent, measure: TextMeasure, context: VectorEvaluationContext, wrapping: 'grapheme' | 'word' = 'grapheme'): RichTextFlow {
  throwIfRegionAborted(context.signal);
  const lines: RichTextFlowLine[] = [];
  let y = content.box.y;
  let largestWidth = 0;
  for (const paragraph of content.paragraphs) {
    y += paragraph.spaceBefore;
    let row: TextRun[] = [];
    let rowWidth = 0;
    let rowHeight = 0;
    const flush = (last = false): void => {
      rowHeight = rowHeight || Math.max(1, ...paragraph.runs.map(run => run.style.leading || run.style.fontSize * 1.25));
      const width = content.box.width || rowWidth;
      lines.push({ text: row.map(run => run.text).join(''), y, width: rowWidth, lineHeight: rowHeight, runs: row, paragraph, last });
      largestWidth = Math.max(largestWidth, width);
      y += rowHeight;
      row = []; rowWidth = 0; rowHeight = 0;
    };
    const add = (text: string, style: TextStyle): void => {
      const previous = row.at(-1);
      // 同一源样式对象才合并，避免切断原生连写并保留既有样式边界。
      const increment = previous?.style === style
        ? textWidth(previous.text + text, style, measure) - textWidth(previous.text, style, measure)
        : textWidth(text, style, measure);
      if (content.box.width && row.length && rowWidth + increment > content.box.width) flush();
      const tail = row.at(-1);
      if (tail?.style === style) { rowWidth += textWidth(tail.text + text, style, measure) - textWidth(tail.text, style, measure); tail.text += text; }
      else { row.push({ text, style }); rowWidth += textWidth(text, style, measure); }
      rowHeight = Math.max(rowHeight, style.leading || style.fontSize * 1.25);
    };
    for (const run of paragraph.runs) {
      throwIfRegionAborted(context.signal);
      const segments = !content.box.width ? run.text.split(/(\r?\n)/u).filter(Boolean).map(segment=>({segment})) : wrapping === 'word' ? [...new Intl.Segmenter(undefined,{granularity:'word'}).segment(run.text)].flatMap(segment => content.box.width && textWidth(segment.segment,run.style,measure) > content.box.width ? [...graphemes.segment(segment.segment)] : [segment]) : graphemes.segment(run.text);
      for (const segment of segments) {
        if (segment.segment === '\n' || segment.segment === '\r\n') { rowHeight = Math.max(rowHeight, run.style.leading || run.style.fontSize * 1.25); flush(); }
        else add(segment.segment, run.style);
      }
    }
    flush(true);
    y += paragraph.spaceAfter;
  }
  return { lines, width: largestWidth, height: y - content.box.y, originY: content.box.y };
}

/** 富文本绘制与数值布局共享这一份定位，保留逐 run 外观次序和段末身份。 */
export function positionRichTextFlow(flow: RichTextFlow, box: RichTextContent['box'], measure: TextMeasure, vertical: TextStyle['verticalAlign']): RichTextPositionPlan {
  const remaining = box.height ? box.height - flow.height : 0
  const contentTop = box.y + (vertical === 'middle' ? remaining / 2 : vertical === 'bottom' ? remaining : 0)
  const offset = contentTop - flow.originY
  let largestWidth = 0
  const rowRuns = flow.lines.map(line => {
    const { paragraph } = line, width = box.width || line.width
    const justify = paragraph.align.startsWith('justify') && (paragraph.align === 'justify-all' || !line.last)
    const pieces = justify ? line.runs.flatMap(run => run.text.split(/(\s+)/u).filter(Boolean).map(text => ({ text, style: run.style }))) : line.runs
    const spaces = pieces.filter(run => /\s/u.test(run.text)).length
    const extra = justify && spaces ? Math.max(0, width - line.width) / spaces : 0
    const direction = paragraph.direction === 'auto' ? /[\u0590-\u08ff]/u.test(line.text) ? 'rtl' : 'ltr' : paragraph.direction
    let x = box.x + (justify ? 0 : paragraph.align === 'center' || paragraph.align === 'justify-center' ? (width - line.width) / 2 : paragraph.align === 'right' || paragraph.align === 'justify-right' ? width - line.width : 0)
    largestWidth = Math.max(largestWidth, width)
    return (direction === 'rtl' ? [...pieces].reverse() : pieces).map(run => {
      const advance = textWidth(run.text, run.style, measure)
      const result = { ...run, x, y: line.y + offset, width: advance, lineHeight: line.lineHeight, direction }
      x += advance + (/\s/u.test(run.text) ? extra : 0)
      return result
    })
  })
  return { contentTop, runs: rowRuns.flat(), rowRuns, lines: flow.lines.map(line => ({ text: line.text, y: line.y + offset, width: line.width, lineHeight: line.lineHeight })), width: largestWidth, height: Math.max(box.height, flow.height) }
}

export function layoutRichText(content: RichTextContent, measure: TextMeasure, context: VectorEvaluationContext, wrapping: 'grapheme' | 'word' = 'grapheme'): RichTextLayout {
  const flow = layoutRichTextFlow(content, measure, context, wrapping)
  const { runs, lines, width, height } = positionRichTextFlow(flow, content.box, measure, content.paragraphs.find(paragraph => paragraph.runs.length)?.runs[0].style.verticalAlign ?? 'top')
  return { runs, lines, width, height }
}

export function richTextFontNames(content: RichTextContent): string[] {
  return [...new Set(content.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.style.fontFamily)))];
}
