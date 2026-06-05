FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY apps/bff ./apps/bff

EXPOSE 3002

CMD ["npm", "run", "start:bff"]
