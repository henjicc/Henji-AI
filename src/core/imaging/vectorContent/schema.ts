import { z } from 'zod';
import { textStyleSchema } from './text';
import type { RichTextContent } from './contracts';

const coordinate = z.number().finite().refine(value => Math.abs(value) <= Number.MAX_SAFE_INTEGER, '路径坐标超出浮点精确坐标范围。');
const nonnegative = coordinate.nonnegative();
const point = { x: coordinate, y: coordinate };
export const vectorPathSchema = z.object({
  commands: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('move'), ...point }).strict(),
    z.object({ kind: z.literal('line'), ...point }).strict(),
    z.object({ kind: z.literal('quadratic'), ...point, cx: coordinate, cy: coordinate }).strict(),
    z.object({ kind: z.literal('cubic'), ...point, cx1: coordinate, cy1: coordinate, cx2: coordinate, cy2: coordinate }).strict(),
    z.object({ kind: z.literal('close') }).strict(),
  ])),
  fillRule: z.enum(['nonzero', 'evenodd']),
}).strict().superRefine((path, context) => {
  let open = false;
  for (const [index, command] of path.commands.entries()) {
    if (command.kind === 'move') open = true;
    else if (!open) context.addIssue({ code: 'custom', path: ['commands', index], message: '路径必须先有起点。' });
    if (command.kind === 'close') open = false;
  }
});
export const richTextContentSchema: z.ZodType<RichTextContent> = z.object({
  paragraphs: z.array(z.object({
    runs: z.array(z.object({ text: z.string(), style: textStyleSchema }).strict()),
    align: textStyleSchema.shape.align,
    direction: z.enum(['auto', 'ltr', 'rtl']),
    spaceBefore: nonnegative,
    spaceAfter: nonnegative,
  }).strict()),
  box: z.object({ ...point, width: nonnegative, height: nonnegative }).strict(),
}).strict();
export const vectorPathContentSchema = z.object({
  operands: z.array(z.object({ path: vectorPathSchema, operation: z.enum(['replace', 'add', 'subtract', 'intersect']) }).strict()),
  paint: z.object({ fill: textStyleSchema.shape.fill, strokes: textStyleSchema.shape.strokes, shadows: textStyleSchema.shape.shadows }).strict(),
}).strict();
