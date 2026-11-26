import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAudioSamples } from './src/engine/mathEngine.ts';
import { encodeMonoWav, parseWavBuffer } from './src/engine/wavParser.ts';
import { generateDeterministicTestTrack } from './src/engine/sampleTrack.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  app.use('/api/analyze', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '4gb' }));
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'seeing-sounds', runtime: 'node' });
  });

  app.get('/api/sample-track', (_req, res) => {
    const { mono, sr } = generateDeterministicTestTrack();
    const wav = encodeMonoWav(mono, sr);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline; filename="zeal_92bpm_fsharp_minor.wav"');
    res.send(Buffer.from(wav));
  });

  app.post('/api/analyze', (req, res) => {
    try {
      const hopMs = Number(req.query.hop_ms || 50);
      const includeSeries = req.query.include_series === 'true';

      if (Buffer.isBuffer(req.body)) {
        const fileName = String(req.query.filename || 'uploaded.wav');
        const arrayBuf = new Uint8Array(req.body).buffer;
        const parsed = parseWavBuffer(arrayBuf);
        const analysis = analyzeAudioSamples(parsed.mono, parsed.sampleRate, fileName, hopMs);
        if (includeSeries) {
          res.json(analysis);
        } else {
          const { series: _series, ...report } = analysis;
          res.json(report);
        }
        return;
      }

      if (req.body && Array.isArray(req.body.samples) && typeof req.body.sampleRate === 'number') {
        const mono = Float32Array.from(req.body.samples);
        const fileName = String(req.body.fileName || 'track.wav');
        const analysis = analyzeAudioSamples(mono, req.body.sampleRate, fileName, hopMs);
        if (includeSeries) {
          res.json(analysis);
        } else {
          const { series: _series, ...report } = analysis;
          res.json(report);
        }
        return;
      }

      res.status(400).json({
        error: 'Send raw WAV binary (Content-Type: audio/wav) or JSON { samples, sampleRate, fileName }.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audio analysis failed.';
      res.status(400).json({ error: message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Seeing Sounds listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
