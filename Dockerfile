FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build:front

EXPOSE 3002

CMD ["npm", "start"]
