FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    fonts-noto-cjk \
    fonts-dejavu-core \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# 完整安装包含 devDependencies，只为能够运行 vite 打包
RUN npm ci

COPY python/pipeline/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt

COPY . .

RUN npm run build:front

RUN mkdir -p data/uploads public/presets/audio public/presets/image

EXPOSE 3001

CMD ["npm", "start"]
