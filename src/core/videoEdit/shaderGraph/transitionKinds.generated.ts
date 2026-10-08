// 由 scripts/generate-shader-components.cjs 生成，勿手改。剪辑过渡种类要在类型里写全，所以单独生成字面量表。
export const SHADER_GRAPH_TRANSITION_KINDS = [
  'shaders.BarnDoors',
  'shaders.BlockDissolve',
  'shaders.CheckerWipe',
  'shaders.DiamondWipe',
  'shaders.IrisWipe',
  'shaders.LinearWipe',
  'shaders.NoiseDissolve',
  'shaders.PagePeel',
  'shaders.RadialWipe',
  'shaders.RandomBars',
  'shaders.RippleWipe',
  'shaders.SliceWipe',
  'shaders.VenetianBlinds',
] as const
