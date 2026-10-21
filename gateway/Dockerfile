# Built from the repository root (docker-compose.yml sets context: ..) so the image also gets
# shared/ (the auto-off timer every machine shares; src/ imports ../../shared/autooff.js).
FROM node:22-alpine
WORKDIR /app
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev
COPY gateway/src ./src
COPY shared /shared
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
