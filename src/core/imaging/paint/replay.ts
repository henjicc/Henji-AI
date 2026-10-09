import { evaluationCacheIdentity } from '../evaluation';
import type { PaintReplay, PaintSurface, PaintTarget } from './contracts';
import { PaintDabGenerator } from './dabs';
import { rasterizePaintDabs } from './rasterize';

/** Host resolves animation and tracking at the supplied source time; tiles share one replay. */
export function replayPaint(surface: PaintSurface, replay: PaintReplay, target: PaintTarget): boolean {
  if (replay.context) evaluationCacheIdentity(replay.context);
  const generator = new PaintDabGenerator(replay.brush);
  let changed = false;
  for (let offset = 0; offset < replay.points.length; offset += 128) {
    replay.context?.signal?.throwIfAborted();
    changed = rasterizePaintDabs(surface, generator.append(replay.points.slice(offset, offset + 128)), replay.brush, target, replay.tool) || changed;
  }
  replay.context?.signal?.throwIfAborted();
  return rasterizePaintDabs(surface, generator.finish(), replay.brush, target, replay.tool) || changed;
}
