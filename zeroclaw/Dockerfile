FROM ghcr.io/zeroclaw-labs/zeroclaw:latest

USER root
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    && npm install -g agent-browser \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

USER 1000