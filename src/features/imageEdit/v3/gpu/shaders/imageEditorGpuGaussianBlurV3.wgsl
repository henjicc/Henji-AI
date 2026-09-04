struct Params {
  operation: vec4f,
  transfer: vec4f,
  domain: vec4f,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

fn encodeSrgb(value: f32) -> f32 {
  let magnitude = abs(value);
  return sign(value) * select(
    12.92 * magnitude,
    1.055 * pow(magnitude, 1.0 / 2.4) - 0.055,
    magnitude > 0.0031308,
  );
}

fn decodeSrgb(value: f32) -> f32 {
  let magnitude = abs(value);
  return sign(value) * select(
    magnitude / 12.92,
    pow((magnitude + 0.055) / 1.055, 2.4),
    magnitude > 0.04045,
  );
}

fn encodePq(value: f32, referenceWhiteNits: f32) -> f32 {
  let m1 = 2610.0 / 16384.0;
  let m2 = 2523.0 / 32.0;
  let c1 = 3424.0 / 4096.0;
  let c2 = 2413.0 / 128.0;
  let c3 = 2392.0 / 128.0;
  let normalizedNits = min(1.0, max(0.0, value) * referenceWhiteNits / 10000.0);
  let power = pow(normalizedNits, m1);
  return pow((c1 + c2 * power) / (1.0 + c3 * power), m2);
}

fn decodePq(value: f32, referenceWhiteNits: f32) -> f32 {
  let m1 = 2610.0 / 16384.0;
  let m2 = 2523.0 / 32.0;
  let c1 = 3424.0 / 4096.0;
  let c2 = 2413.0 / 128.0;
  let c3 = 2392.0 / 128.0;
  let power = pow(clamp(value, 0.0, 1.0), 1.0 / m2);
  let denominator = c2 - c3 * power;
  if (denominator <= 0.0) { return 10000.0 / referenceWhiteNits; }
  return pow(max(power - c1, 0.0) / denominator, 1.0 / m1) * 10000.0 / referenceWhiteNits;
}

fn encodeHlg(value: f32) -> f32 {
  let linear = max(0.0, value);
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  return select(a * log(12.0 * linear - b) + c, sqrt(3.0 * linear), linear <= 1.0 / 12.0);
}

fn decodeHlg(value: f32) -> f32 {
  let encoded = clamp(value, 0.0, 1.0);
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  return select((exp((encoded - c) / a) + b) / 12.0,
    encoded * encoded / 3.0, encoded <= 0.5);
}

fn encodeTransfer(value: f32) -> f32 {
  let code = params.domain.x;
  if (code < 0.5) { return value; }
  if (code < 1.5) { return encodeSrgb(value); }
  if (code < 2.5) { return encodePq(value, params.domain.y); }
  return encodeHlg(value);
}

fn decodeTransfer(value: f32) -> f32 {
  let code = params.domain.x;
  if (code < 0.5) { return value; }
  if (code < 1.5) { return decodeSrgb(value); }
  if (code < 2.5) { return decodePq(value, params.domain.y); }
  return decodeHlg(value);
}

fn convertDomain(color: vec4f, encode: bool) -> vec4f {
  if (color.a <= 0.0) { return vec4f(0.0); }
  let straight = color.rgb / color.a;
  let converted = select(
    vec3f(decodeTransfer(straight.r), decodeTransfer(straight.g), decodeTransfer(straight.b)),
    vec3f(encodeTransfer(straight.r), encodeTransfer(straight.g), encodeTransfer(straight.b)),
    encode,
  );
  return vec4f(converted * color.a, color.a);
}

fn loadClamped(coord: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(source));
  return textureLoad(source, clamp(coord, vec2i(0), size - vec2i(1)), 0);
}

fn gaussian(position: vec2i) -> vec4f {
  let radius = i32(params.operation.w + 0.5);
  let sigma = max(params.transfer.x, 0.000001);
  let direction = vec2i(params.operation.yz);
  var total = 0.0;
  var result = vec4f(0.0);
  for (var offset = -radius; offset <= radius; offset += 1) {
    let distance = f32(offset);
    let weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
    result += loadClamped(position + direction * offset) * weight;
    total += weight;
  }
  return result / max(total, 0.000001);
}

fn downsample(position: vec2i) -> vec4f {
  let sourceSize = vec2i(textureDimensions(source));
  let origin = position * 2;
  var result = vec4f(0.0);
  var count = 0.0;
  for (var y = 0; y < 2; y += 1) {
    for (var x = 0; x < 2; x += 1) {
      let samplePosition = origin + vec2i(x, y);
      if (all(samplePosition < sourceSize)) {
        result += textureLoad(source, samplePosition, 0);
        count += 1.0;
      }
    }
  }
  return result / max(count, 1.0);
}

fn upsample(position: vec2i) -> vec4f {
  let sourceSize = vec2f(textureDimensions(source));
  let targetSize = params.transfer.yz;
  let sourcePosition = (vec2f(position) + 0.5) * sourceSize / targetSize - 0.5;
  let base = vec2i(floor(sourcePosition));
  let amount = clamp(fract(sourcePosition), vec2f(0.0), vec2f(1.0));
  let top = mix(loadClamped(base), loadClamped(base + vec2i(1, 0)), amount.x);
  let bottom = mix(loadClamped(base + vec2i(0, 1)), loadClamped(base + vec2i(1, 1)), amount.x);
  return mix(top, bottom, amount.y);
}

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let operation = u32(params.operation.x);
  let pixel = vec2i(position.xy);
  if (operation == 0u) { return gaussian(pixel); }
  if (operation == 1u) { return downsample(pixel); }
  if (operation == 2u) { return upsample(pixel); }
  return convertDomain(textureLoad(source, pixel, 0), operation == 3u);
}
