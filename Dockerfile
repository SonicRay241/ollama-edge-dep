FROM oven/bun:1-alpine
WORKDIR /app
COPY auth.ts .
CMD ["bun", "run", "/app/auth.ts"]