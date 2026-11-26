export interface ParsedWav {
  sampleRate: number;
  channels: number;
  mono: Float32Array;
}

export function parseWavBuffer(buffer: ArrayBuffer): ParsedWav {
  if (buffer.byteLength < 44) {
    throw new Error('File is too small to be a valid WAV audio file.');
  }
  const view = new DataView(buffer);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Unsupported WAV header (expected RIFF/WAVE).');
  }

  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;

    if (chunkId === 'fmt ') {
      if (bodyStart + 16 > view.byteLength) {
        throw new Error('Corrupt WAV fmt chunk.');
      }
      audioFormat = view.getUint16(bodyStart, true);
      numChannels = view.getUint16(bodyStart + 2, true);
      sampleRate = view.getUint32(bodyStart + 4, true);
      bitsPerSample = view.getUint16(bodyStart + 14, true);
      if (audioFormat === 0xfffe && chunkSize >= 40 && bodyStart + 26 <= view.byteLength) {
        // WAVE_FORMAT_EXTENSIBLE: subformat GUID first 2 bytes
        audioFormat = view.getUint16(bodyStart + 24, true);
      }
    } else if (chunkId === 'data') {
      dataOffset = bodyStart;
      dataSize = Math.min(chunkSize, view.byteLength - bodyStart);
      break;
    }

    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error('WAV file contains no audio data chunk.');
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV encoding format (${audioFormat}); expected PCM or IEEE float.`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * numChannels;
  const numFrames = Math.floor(dataSize / frameSize);
  const mono = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    const frameBase = dataOffset + i * frameSize;
    for (let ch = 0; ch < numChannels; ch++) {
      const sampleOffset = frameBase + ch * bytesPerSample;
      let val = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        val = view.getFloat32(sampleOffset, true);
      } else if (bitsPerSample === 8) {
        val = (view.getUint8(sampleOffset) - 128) / 128.0;
      } else if (bitsPerSample === 16) {
        val = view.getInt16(sampleOffset, true) / 32768.0;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(sampleOffset);
        const b1 = view.getUint8(sampleOffset + 1);
        const b2 = view.getUint8(sampleOffset + 2);
        let raw = b0 | (b1 << 8) | (b2 << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        val = raw / 8388608.0;
      } else if (bitsPerSample === 32) {
        val = view.getInt32(sampleOffset, true) / 2147483648.0;
      } else {
        throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}-bit.`);
      }
      sum += val;
    }
    mono[i] = sum / numChannels;
  }

  return { sampleRate, channels: numChannels, mono };
}

export function encodeMonoWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + numBytes);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numBytes, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    pos += 2;
  }
  return buffer;
}
