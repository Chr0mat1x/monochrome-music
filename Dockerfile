# MONOCHROME — web deployment.
#
# The site needs a server: SoundCloud's API sends no CORS headers, so the
# browser cannot call it directly, and the audio CDN refuses anonymous
# datacenter requests. This image runs `server/index.mjs`, which proxies the
# catalogue and stitches SoundCloud's HLS fragments into a seekable MP4.
#
# Deliberately no yt-dlp and no ffmpeg. The SoundCloud path is pure HTTP
# (api-v2 + the HLS stitcher), so the image stays small and the build is a
# plain `npm ci && vite build`.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
# The APK is published on GitHub Releases, not baked into the image; if it is
# absent the /MONOCHROME.apk route simply 404s.
RUN mkdir -p downloads
EXPOSE 8787
CMD ["node", "server/index.mjs"]
