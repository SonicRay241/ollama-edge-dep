FROM oven/bun:1-alpine
WORKDIR /app
COPY auth.ts .
RUN mkdir -p /app/state && chown -R bun:bun /app
VOLUME ["/app/state"]
USER bun
CMD ["bun", "run", "/app/auth.ts"]