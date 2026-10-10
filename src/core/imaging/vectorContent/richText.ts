import type { RichTextContent, TextRun, VectorEvaluationContext } from './contracts';
import { textWidth } from './metrics';
import type { TextStyle } from './text';
import { throwIfRegionAborted } from '../regions';

export interface PositionedTextRun extends TextRun { x: number; y: number; width: number; lineHeight: number; direction: 'auto' | 'ltr' | 'rtl' }
export interface RichTextLayout { runs: PositionedTextRun[]; lines: Array<{text:string;y:number;width:number;lineHeight:number}>; width: number; height: number }
export type TextMeasure = (text: string, font: string) => number;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Never split a grapheme or silently drop paragraphs. Whole runs retain native shaping. */
export function layoutRichText(content: RichTextContent, measure: TextMeasure, context: VectorEvaluationContext, wrapping: 'grapheme' | 'word' = 'grapheme'): RichTextLayout {
  throwIfRegionAborted(context.signal);
  const output: PositionedTextRun[] = [];
  const lines: RichTextLayout['lines'] = [];
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
      lines.push({text:row.map(run => run.text).join(''),y,width:rowWidth,lineHeight:rowHeight});
      const align = paragraph.align;
      const justify = align.startsWith('justify') && (align === 'justify-all' || !last);
      const pieces = justify ? row.flatMap(run => run.text.split(/(\s+)/u).filter(Boolean).map(text => ({ text, style: run.style }))) : row;
      const spaces = pieces.filter(run => /\s/u.test(run.text)).length;
      const extra = justify && spaces ? Math.max(0, width - rowWidth) / spaces : 0;
      const direction = paragraph.direction === 'auto' ? /[\u0590-\u08ff]/u.test(row.map(run => run.text).join('')) ? 'rtl' : 'ltr' : paragraph.direction;
      let x = content.box.x + (justify ? 0 : align === 'center' || align === 'justify-center' ? (width - rowWidth) / 2 : align === 'right' || align === 'justify-right' ? width - rowWidth : 0);
      for (const run of direction === 'rtl' ? [...pieces].reverse() : pieces) {
        const advance = textWidth(run.text, run.style, measure);
        output.push({ ...run, x, y, width: advance, lineHeight: rowHeight, direction });
        x += advance + (/\s/u.test(run.text) ? extra : 0);
      }
      largestWidth = Math.max(largestWidth, width);
      y += rowHeight;
      row = []; rowWidth = 0; rowHeight = 0;
    };
    const add = (text: string, style: TextStyle): void => {
      const previous = row.at(-1);
      // Merge only a single source style, avoiding a shaping break at each character.
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
  const contentHeight = y - content.box.y;
  const vertical = content.paragraphs.find(paragraph=>paragraph.runs.length)?.runs[0].style.verticalAlign ?? 'top';
  const remaining = content.box.height ? content.box.height - contentHeight : 0;
  const offset = vertical === 'middle' ? remaining / 2 : vertical === 'bottom' ? remaining : 0;
  if(offset){for(const run of output)run.y += offset;for(const line of lines)line.y += offset;}
  return { runs: output, lines, width: largestWidth, height: Math.max(content.box.height, contentHeight) };
}

export function richTextFontNames(content: RichTextContent): string[] {
  return [...new Set(content.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.style.fontFamily)))];
}
