# Servidor da equipe LinkLeads. Construa a partir da raiz do repositório:
#   docker build -f apps/server/Dockerfile -t linkleads-server .
#   docker run -d -p 8787:8787 -v linkleads-data:/data linkleads-server
# Rode atrás de HTTPS (Caddy, Nginx ou o balanceador da nuvem).
FROM node:22-slim
COPY tsconfig.base.json /tsconfig.base.json
WORKDIR /app/server
COPY apps/server/package.json apps/server/tsconfig.json ./
COPY apps/server/src ./src
COPY apps/server/public ./public
RUN sed -i 's#"../../tsconfig.base.json"#"/tsconfig.base.json"#' tsconfig.json \
 && npx -y typescript@5.6.3 -p tsconfig.json \
 && mkdir -p /data && chown node:node /data
ENV LINKLEADS_DB=/data/linkleads-server.db LINKLEADS_PORT=8787
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "dist/cli.js", "serve"]
