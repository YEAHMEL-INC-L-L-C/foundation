# Web app on Google Cloud Run

The web version of Seeing Sounds is one container: a FastAPI server that runs
the Python engines and serves the React interface.

```
[Google Cloud Run (FastAPI container, Hypercorn, HTTP/2)]
    |--> GET  /             React interface (built into dist/)
    |--> POST /api/analyze  math_engine.py: BPM, key, chroma, beat grid, phrases, tension
    |                       (?include_visual=true adds the /api/visual frames, one upload)
    |--> POST /api/visual   visual_engine.py: deterministic color and motion coordinates
    |--> GET  /api/health   liveness check
            |
            v
 [Browser canvas] --> 60 fps visualizer and video export, drawn on the viewer's device
```

The desktop and iOS app run the same math in TypeScript on the device, and
`tests/test_api.py` checks that the Python and TypeScript engines agree.

## Uploads

- Mono or stereo WAV at 8, 16, 24 or 32-bit (integer or float), FLAC, OGG and
  MP3 are read on the server. Other formats the browser can play (such as M4A)
  are decoded in the browser and uploaded as WAV.
- The original file is uploaded unchanged, at any size. Cloud Run limits
  HTTP/1 request bodies to 32 MiB, so the service must be deployed with
  `--use-http2`; the container serves HTTP/2 cleartext through Hypercorn.
- The server writes the upload to a temporary file, reads it once as mono
  32-bit float audio (exact for 16 and 24-bit sources), deletes the file, then
  runs the math. Nothing is kept after the response.
- Memory: plan on about 3 times the largest WAV you expect. A 20-minute
  48 kHz stereo 24-bit WAV (345 MB) needed about 0.9 GB. On Cloud Run, `/tmp`
  is held in memory and counts toward the limit.
- If the server can't be reached, the app analyzes on the device instead, so
  it keeps working offline.

## Deploy

You need the [gcloud CLI](https://cloud.google.com/sdk/docs/install), a Google
Cloud project with billing turned on, and the Cloud Run, Cloud Build and
Artifact Registry APIs enabled. From the repository root:

```bash
gcloud run deploy seeing-sounds \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --use-http2 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 4 \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 3
```

- `--source .` builds the `Dockerfile` with Cloud Build.
- `--use-http2` removes the 32 MiB upload limit. Without it, uploads over
  32 MiB fail.
- `--region us-central1` is one of the regions that supports custom domain
  mapping (below).
- `--timeout 3600` gives slow connections up to an hour to upload a large WAV.
- `--min-instances 0` scales to zero when idle, so an idle service costs
  nothing for compute.
- `--max-instances 3` caps cost during a traffic spike. Raise it as real
  traffic grows.
- `--memory 1Gi` covers songs up to roughly 300 MB of WAV. Raise it (up to
  32Gi) for very long hi-res files, or lower `--concurrency` so fewer large
  uploads share one instance.

Also set a budget alert (Billing, then Budgets & alerts) so you get an email
before spending passes an amount you choose.

## Custom domain (app.yeahmel.com)

Cloud Run domain mapping is free and supports `us-central1`. Google labels it
Preview and not recommended for production; a global external Application
Load Balancer is the production option but has a monthly cost.

1. In the Cloud Run console, open Domain mappings, then Add mapping. Choose
   the `seeing-sounds` service and Cloud Run Domain Mappings.
2. Verify `yeahmel.com` when asked. Search Console shows a TXT record to add
   at the domain's DNS host (Wix). Verify with the same Google account that
   owns the Cloud Project.
3. Map `app.yeahmel.com`. Cloud Run shows the DNS record to add, a CNAME with
   host `app` pointing to `ghs.googlehosted.com.`
4. The HTTPS certificate is issued automatically, usually within 15 minutes
   and at most 24 hours.

After it deploys, check it with the URL that `gcloud` prints:

```bash
curl https://YOUR-SERVICE-URL/api/health
```

## Cost

The server only computes the analysis JSON; the visualizer and video export
run in the viewer's browser, so there is no GPU cost.

`C_total = (N_req × C_inv) + (T_cpu × C_cpu) + (M_ram × C_ram) + C_storage − Credit_allowance`

Measured on this code:

| Input | Value |
|---|---|
| Requests per track (`N_req`) | 1 (`/api/analyze?include_visual=true`) |
| CPU per 3-minute track (`T_cpu`) | about 1.1 vCPU-seconds (0.5 analysis + 0.6 visual) |
| Three real 1.5 to 2.6-minute stereo WAVs, upload plus analysis | 0.6 to 1.1 seconds each |
| Storage (`C_storage`) | 0: uploads live in a temporary file deleted before the math runs |

Uploads into Cloud Run are not billed as egress. Check current Cloud Run
prices at https://cloud.google.com/run/pricing.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements-dev.txt
npm install
npm run build
hypercorn api.main:app --bind 127.0.0.1:8080
```

Then open http://localhost:8080. Run the tests (they also need Node.js for
the TypeScript comparison):

```bash
pytest
```
