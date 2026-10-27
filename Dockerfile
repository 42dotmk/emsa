FROM oven/bun:1.4 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/tsconfig.json ./
RUN chown -R bun:bun /app
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
CMD ["bun", "start"]
