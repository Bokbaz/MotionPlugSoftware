const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function encodeWav(channels: Float32Array[], sampleRate = 48_000): Uint8Array {
  const first = channels[0];
  if (!first || channels.some((channel) => channel.length !== first.length)) {
    throw new Error("WAV channels must be non-empty and have matching lengths.");
  }
  const channelCount = channels.length;
  const bytesPerSample = 2;
  const dataLength = first.length * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let index = 0; index < first.length; index += 1) {
    for (const channel of channels) {
      view.setInt16(offset, Math.round(clamp(channel[index] ?? 0) * 0x7fff), true);
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}

