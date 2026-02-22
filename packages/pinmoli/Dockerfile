FROM node:20-alpine

# Install ffmpeg for audio streaming
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose SIP and RTP ports
EXPOSE 5060/udp
EXPOSE 10000/udp

# Default command
CMD ["node", "dist/cli.js"]
