#!/usr/bin/env node
/* Turn Motion Plug's RGB/RGBA PNG logo into a classic multi-size BMP-backed
 * ICO. NSIS accepts these entries consistently on macOS, Linux, and Windows. */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

function decodePng(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let position = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const imageData = [];
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position);
    const type = buffer.toString('ascii', position + 4, position + 8);
    const data = buffer.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
        throw new Error(`${file}: expected an 8-bit, non-interlaced RGB or RGBA PNG`);
      }
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    position += length + 12;
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowSize = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(imageData));
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(rowSize);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowSize + 1)];
    const row = Buffer.from(raw.subarray(y * (rowSize + 1) + 1, (y + 1) * (rowSize + 1)));
    for (let x = 0; x < rowSize; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + above) & 0xff;
      else if (filter === 3) row[x] = (row[x] + ((left + above) >> 1)) & 0xff;
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        row[x] = (row[x] + (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`${file}: unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x++) {
      const source = x * bytesPerPixel;
      const destination = (y * width + x) * 4;
      rgba[destination] = row[source];
      rgba[destination + 1] = row[source + 1];
      rgba[destination + 2] = row[source + 2];
      rgba[destination + 3] = bytesPerPixel === 4 ? row[source + 3] : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

function resize(source, size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor(((y + 0.5) * source.height) / size));
    for (let x = 0; x < size; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor(((x + 0.5) * source.width) / size));
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * size + x) * 4;
      source.rgba.copy(rgba, to, from, from + 4);
    }
  }
  return { width: size, height: size, rgba };
}

function bitmapEntry(image) {
  const width = image.width;
  const height = image.height;
  const maskStride = ((width + 31) >> 5) * 4;
  const pixelBytes = width * height * 4;
  const entry = Buffer.alloc(40 + pixelBytes + maskStride * height);
  entry.writeUInt32LE(40, 0);
  entry.writeInt32LE(width, 4);
  entry.writeInt32LE(height * 2, 8);
  entry.writeUInt16LE(1, 12);
  entry.writeUInt16LE(32, 14);
  entry.writeUInt32LE(pixelBytes + maskStride * height, 20);
  for (let y = 0; y < height; y++) {
    const sourceRow = height - y - 1;
    for (let x = 0; x < width; x++) {
      const from = (sourceRow * width + x) * 4;
      const to = 40 + (y * width + x) * 4;
      entry[to] = image.rgba[from + 2];
      entry[to + 1] = image.rgba[from + 1];
      entry[to + 2] = image.rgba[from];
      entry[to + 3] = image.rgba[from + 3];
    }
  }
  return entry;
}

const output = process.argv[2];
const input = process.argv[3];
if (!output || !input) {
  console.error('Usage: make-ico.cjs <output.ico> <source.png>');
  process.exit(1);
}

const decoded = decodePng(input);
const images = [16, 32, 48, 256].map((size) => resize(decoded, size));
const entries = images.map(bitmapEntry);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16;
const directories = images.map((image, index) => {
  const directory = Buffer.alloc(16);
  directory.writeUInt8(image.width >= 256 ? 0 : image.width, 0);
  directory.writeUInt8(image.height >= 256 ? 0 : image.height, 1);
  directory.writeUInt16LE(1, 4);
  directory.writeUInt16LE(32, 6);
  directory.writeUInt32LE(entries[index].length, 8);
  directory.writeUInt32LE(offset, 12);
  offset += entries[index].length;
  return directory;
});
fs.writeFileSync(output, Buffer.concat([header, ...directories, ...entries]));
console.log(`Wrote ${output} (${images.length} icon sizes).`);
