# Applicant agent — COSMIC/COS side of the conversational interop demo
FROM oven/bun:1.2-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY tsconfig.json ./
COPY src/       ./src/
COPY scenarios/ ./scenarios/
COPY scripts/   ./scripts/

ENTRYPOINT ["bun", "run", "src/applicant-agent.ts"]
