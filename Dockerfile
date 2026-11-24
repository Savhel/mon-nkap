# Image du moteur Mon Nkap (API + canaux + pages de démonstration).
#   docker build -t mon-nkap .
#   docker run -p 8080:8080 -e CT_API_KEYS="banqueA:<cle-longue>" -v $PWD/models:/app/models -v ct-audit:/app/data/audit mon-nkap
# Les modèles vocaux (environ 450 Mo) ne sont pas dans l'image : `npm run models` sur l'hôte, puis montage de models/.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && apt-get clean
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY data ./data
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8080/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/api/server.ts"]
