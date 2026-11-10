/** 淡化手柄：一个空心小圆点，骑在淡化终点上；片段角上的新建手柄与淡化块内缘的调整手柄共用。 */
export function VideoEditFadeGlyph(): React.ReactElement {
  return <span aria-hidden="true" className="pointer-events-none block h-2 w-2 rounded-full bg-window ring-1 ring-inset ring-text1" />
}
