# Seeing Sounds web app for Google Cloud Run.
# Stage 1 builds the React interface; stage 2 serves it with the FastAPI
# engines over HTTP/2 cleartext (deploy with --use-http2, see docs/cloud-run.md).

FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY privacy ./privacy
COPY terms ./terms
COPY src ./src
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY math_engine.py visual_engine.py ./
COPY api ./api
COPY --from=web /app/dist ./dist
RUN useradd --system --uid 10001 app
USER app
# One worker per instance; Cloud Run scales by adding instances.
CMD ["sh", "-c", "exec hypercorn api.main:app --bind 0.0.0.0:${PORT} --workers 1"]
