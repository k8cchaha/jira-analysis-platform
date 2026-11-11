# Next.js standalone image for the KKS devops tenant cluster (see deploy.sh).
# Contract: serves HTTP on 8080 (= k8s containerPort / service targetPort) and
# returns 200 on /api/healthz (= deploy.sh HEALTHCHECK_PATH).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
# standalone 不含 public 與 .next/static，需手動複製後 server.js 才會自行提供。
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
