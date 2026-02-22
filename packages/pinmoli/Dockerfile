FROM node:20-alpine

# Install ffmpeg and espeak for audio generation
RUN apk add --no-cache ffmpeg espeak

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate audio samples
RUN sh generate-audio-samples.sh

# Build TypeScript
RUN npm run build

# Expose SIP and RTP ports
EXPOSE 5060/udp
EXPOSE 10000/udp

# Default command
CMD ["node", "dist/cli.js"]
