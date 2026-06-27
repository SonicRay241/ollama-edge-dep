FROM oven/bun:1-alpine
WORKDIR /app
COPY auth.ts .
RUN mkdir -p /app/state && chown -R bun:bun /app
VOLUME ["/app/state"]
COPY --chmod=755 <<'ENTRY' /app/entrypoint.sh
#!/bin/sh
set -e
# Ensure the mounted volume is writable by the bun user.
if [ -d /app/state ]; then
  chown -R bun:bun /app/state
fi
exec su-exec bun bun run /app/auth.ts
ENTRY
CMD ["/app/entrypoint.sh"]
