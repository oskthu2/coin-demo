# Custom banterop build that fetches the a2a submodule during Docker build,
# bypassing the unreliable nested-submodule chain on the host.
FROM oven/bun:latest AS runtime

# Need git to clone a2a
RUN apt-get update -qq && apt-get install -y -qq git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bunfig.toml tsconfig.json ./
RUN bun install --ci

COPY src ./src
COPY tests ./tests

# Clone the a2a spec that banterop imports at build time.
# This replaces the nested git submodule so the Docker build is self-contained.
RUN git clone --depth=1 https://github.com/a2aproject/A2A.git a2a

RUN useradd -u 10001 -m appuser 2>/dev/null \
    || adduser --disabled-password --gecos "" --uid 10001 appuser \
    && mkdir -p /app/public \
    && chown -R 10001:10001 /app
USER appuser

ENV PORT=3000 \
    NODE_ENV=production

EXPOSE 3000
VOLUME ["/data"]
CMD ["bun", "run", "start"]
