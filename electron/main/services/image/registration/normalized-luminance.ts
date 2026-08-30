import type { RegistrationFrame } from "./types";

/** Per-channel standardization makes structural matching insensitive to
 * independent RGB gain/bias changes before channels are combined. */
export function normalizedLuminance(frame: RegistrationFrame): Float32Array {
  const count = frame.width * frame.height;
  const channelCount = frame.components >= 3 ? 3 : 1;
  const sums = new Float64Array(channelCount);
  const sumsSquared = new Float64Array(channelCount);
  let validCount = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    if (frame.validMask && !frame.validMask[pixel]) continue;
    const offset = pixel * frame.components;
    for (let channel = 0; channel < channelCount; channel++) {
      const value = frame.data[offset + channel];
      sums[channel] += value;
      sumsSquared[channel] += value * value;
    }
    validCount++;
  }
  if (validCount < 64)
    throw new Error("insufficient valid registration pixels");
  const means = Array.from(sums, (sum) => sum / validCount);
  const deviations = Array.from(sumsSquared, (sumSquared, channel) =>
    Math.sqrt(
      Math.max(1, sumSquared / validCount - means[channel] * means[channel]),
    ),
  );
  const output = new Float32Array(count);
  const weights = channelCount === 3 ? [0.299, 0.587, 0.114] : [1];
  for (let pixel = 0; pixel < count; pixel++) {
    if (frame.validMask && !frame.validMask[pixel]) continue;
    const offset = pixel * frame.components;
    let value = 0;
    for (let channel = 0; channel < channelCount; channel++) {
      value +=
        weights[channel] *
        ((frame.data[offset + channel] - means[channel]) / deviations[channel]);
    }
    output[pixel] = Math.max(-3, Math.min(3, value));
  }
  return output;
}
