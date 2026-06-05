FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY apps/bff ./apps/bff
COPY packages ./packages
COPY frontend ./frontend
COPY vite.config.mjs ./vite.config.mjs

RUN npm run build:front

EXPOSE 3002

CMD ["npm", "run", "start:bff"]
