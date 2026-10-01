# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:26.7.0-bookworm-slim@sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32 AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:26.7.0-bookworm-slim@sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements-recommendation.txt /tmp/requirements-recommendation.txt
RUN python3 -m venv /opt/recommendation-venv \
    && /opt/recommendation-venv/bin/pip install --no-cache-dir -r /tmp/requirements-recommendation.txt \
    && rm /tmp/requirements-recommendation.txt
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/scripts/recommendation-runner.py backend/scripts/probe-workout-media.mjs backend/scripts/verify-deployment.mjs backend/scripts/start-render.mjs ./scripts/
COPY backend/deploy/media-verification.json ./deploy/media-verification.json
# Preserve the data team's directory boundary; never copy these into backend/.
COPY data-analysis/src/recommendation_v2.py /app/data-analysis/src/recommendation_v2.py
COPY data-analysis/data/processed/workout_videos_v2_complete.csv /app/data-analysis/data/processed/workout_videos_v2_complete.csv
RUN chmod -R a-w /app/data-analysis /app/backend/deploy
ENV NODE_ENV=production \
    PORT=10000 \
    PYTHONDONTWRITEBYTECODE=1 \
    RECOMMENDATION_PYTHON=/opt/recommendation-venv/bin/python \
    RECOMMENDATION_SOURCE_PATH=/app/data-analysis/src/recommendation_v2.py \
    WORKOUT_VIDEOS_PATH=/app/data-analysis/data/processed/workout_videos_v2_complete.csv \
    WORKOUT_MEDIA_REPORT_PATH=/app/backend/deploy/media-verification.json
USER node
RUN node scripts/verify-deployment.mjs
EXPOSE 10000
CMD ["node", "scripts/start-render.mjs"]
