// Writes the built-in sample track and the TypeScript engines' results for it,
// so tests/test_api.py can check that the Python server agrees.
// Usage: npx tsx scripts/engine-snapshot.ts <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeAudioSamples } from '../src/engine/mathEngine.ts';
import { generateDeterministicTestTrack } from '../src/engine/sampleTrack.ts';
import { computeVisualReport } from '../src/engine/visualizerMath.ts';
import { encodeMonoWav, parseWavBuffer } from '../src/engine/wavParser.ts';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: engine-snapshot.ts <out-dir>');
mkdirSync(outDir, { recursive: true });

const { mono, sr } = generateDeterministicTestTrack();
const wav = encodeMonoWav(mono, sr);
writeFileSync(path.join(outDir, 'sample.wav'), Buffer.from(wav));

// Analyze the WAV as decoded, exactly as the app does after an upload.
const parsed = parseWavBuffer(wav);
const { series: _series, ...analysis } = analyzeAudioSamples(parsed.mono, parsed.sampleRate, 'sample.wav', 50);
writeFileSync(path.join(outDir, 'analysis.json'), JSON.stringify(analysis));
writeFileSync(path.join(outDir, 'visual.json'), JSON.stringify(computeVisualReport(parsed.mono, parsed.sampleRate)));
