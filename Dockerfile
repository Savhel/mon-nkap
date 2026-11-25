# Image du moteur Mon Nkap (API + canaux + pages de démonstration).
#   docker build -t mon-nkap .
#   docker run -p 8080:8080 -e CT_API_KEYS="banqueA:<cle-longue>" -v $PWD/models:/app/models -v ct-audit:/app/data/audit mon-nkap
# Les modèles (voix ≈ 450 Mo, traduction Flagship ≈ 800 Mo) ne sont pas dans l'image : `npm run models` et
# `npm run mt:models` sur l'hôte, puis montage de models/. Le service de traduction (obligatoire) est démarré par le moteur.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv && apt-get clean
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY services ./services
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r services/requirements.txt
COPY src ./src
COPY public ./public
COPY data ./data
COPY tools ./tools
RUN mkdir -p data/audit && chown -R node:node data
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8080/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/api/server.ts"]
