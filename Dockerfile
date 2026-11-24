FROM node:22-alpine
# ffmpeg muuntaa adminien lähettämät videot muotoon, joka toistuu kaikissa selaimissa (ks. README: Videot)
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
