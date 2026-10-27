FROM node:22-alpine AS build
WORKDIR /app
COPY portal/ ./portal/
COPY scripts/ ./scripts/
COPY upstream/everything/ ./upstream/everything/
RUN sh ./scripts/build.sh

FROM nginx:1.29-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
