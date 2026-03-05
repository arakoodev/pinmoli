FROM node:20-alpine

# Install ffmpeg and espeak for audio generation
RUN apk add --no-cache ffmpeg espeak tini tcpdump

WORKDIR /app

# Copy package.json first for dependency caching
COPY package.json .

# Install dependencies (cached unless package.json changes)
RUN npm install

# Copy source code
COPY . .

# Generate audio samples
RUN sh generate-audio-samples.sh

# Type-check
RUN npx tsc --noEmit

# Lint
RUN npm run lint

# Build TypeScript
RUN npm run build

# Run unit + integration tests (live tests need network, run separately)
RUN npx vitest run test/unit/ test/integration/

# Expose SIP and RTP ports
EXPOSE 5060/udp
EXPOSE 10000/udp

ENTRYPOINT ["sh", "entrypoint.sh"]
