FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
RUN apk add --no-cache ffmpeg sipp espeak-ng
COPY package*.json ./
RUN npm install

# Expose Next.js development server port
EXPOSE 3000

# Next.js development server
CMD ["npm", "run", "dev"]
