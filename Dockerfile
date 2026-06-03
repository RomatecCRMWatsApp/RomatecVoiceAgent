FROM node:20-alpine
WORKDIR /app

# cache-bust: 2026-05-20-v3.23.0
# v3.6.0 — Python + deps para o parser DXF (módulo Planta da Quadra).
# - shapely vem precompilado do repo Alpine (py3-shapely 2.x) → zero compilação C
# - ezdxf é pure Python → pip install rápido
# - PYTHON_BIN exporta o binário pro wrapper Node (src/services/parserDxfPython.ts)
RUN apk add --no-cache python3 py3-pip py3-shapely \
    && pip install --break-system-packages --no-cache-dir 'ezdxf>=1.3'
ENV PYTHON_BIN=python3

# v3.51.0 — libs nativas para compilar o node-canvas (overlay das fotos do VTA).
# Alpine/musl não tem prebuilt do canvas, então ele compila do fonte e precisa do cairo.
RUN apk add --no-cache build-base g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev pkgconfig

# v1.99.16 — Chromium do sistema para os templates Prime (puppeteer HTML→PDF).
# O Chromium empacotado pelo puppeteer é glibc e NÃO roda em Alpine/musl; por isso
# usamos o pacote `chromium` do Alpine e pulamos o download do puppeteer.
# ttf-freefont + font-noto cobrem o fallback das fontes Google nos PDFs.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["npm", "run", "start"]
