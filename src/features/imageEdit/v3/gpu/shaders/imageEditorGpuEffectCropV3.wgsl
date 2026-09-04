struct Crop { offset: vec2f, sourceSize: vec2f }
@group(0) @binding(0) var<uniform> crop: Crop;
@group(0) @binding(1) var source: texture_2d<f32>;

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let coordinate = vec2i(position.xy + crop.offset);
  if (any(coordinate < vec2i(0)) || any(coordinate >= vec2i(crop.sourceSize))) {
    return vec4f(0.0);
  }
  return textureLoad(source, coordinate, 0);
}
