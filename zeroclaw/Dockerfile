FROM ghcr.io/zeroclaw-labs/zeroclaw:latest

USER root
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    npm \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    && npm install -g agent-browser \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

USER 1000

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["xvfb-run", "-a", "/start.sh"]