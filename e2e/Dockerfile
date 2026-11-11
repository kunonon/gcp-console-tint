FROM node:26-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2t64 \
      libatk-bridge2.0-0t64 \
      libatk1.0-0t64 \
      libatspi2.0-0t64 \
      libcairo2 \
      libcups2t64 \
      libdbus-1-3 \
      libdbus-glib-1-2 \
      libdrm2 \
      libexpat1 \
      libfontconfig1 \
      libfreetype6 \
      libgbm1 \
      libglib2.0-0t64 \
      libgtk-3-0t64 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
      libxtst6 \
      libvulkan1 \
      openssl \
      unzip \
      xz-utils \
      xauth \
      xvfb \
    && rm -rf /var/lib/apt/lists/*

# node:26 images do not ship corepack, so it comes from npm at a pinned version.
RUN npm install -g corepack@0.36.0 && corepack enable

WORKDIR /workspace
