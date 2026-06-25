FROM ghcr.io/zeroclaw-labs/zeroclaw:debian

USER root
RUN apt update && apt install -y chromium chromium-sandbox nodejs npm python3-pip && apt clean && rm -rf /var/lib/apt/lists/*

# RUN npm install -g agent-browser \
#     && apt clean \
#     && rm -rf /var/lib/apt/lists/*

# RUN agent-browser install --with-deps