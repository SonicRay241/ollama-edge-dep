FROM ghcr.io/zeroclaw-labs/zeroclaw:latest

USER root
RUN apt update && apt install -y chromium chromium-sandbox

RUN npm install -g agent-browser \
    && apt clean \
    && rm -rf /var/lib/apt/lists/*

USER 1000