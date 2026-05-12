FROM node:20-alpine
WORKDIR /app

# v3.6.0 — Python + deps para o parser DXF (módulo Planta da Quadra).
# - shapely vem precompilado do repo Alpine (py3-shapely 2.x) → zero compilação C
# - ezdxf é pure Python → pip install rápido
# - PYTHON_BIN exporta o binário pro wrapper Node (src/services/parserDxfPython.ts)
RUN apk add --no-cache python3 py3-pip py3-shapely \
    && pip install --break-system-packages --no-cache-dir 'ezdxf>=1.3'
ENV PYTHON_BIN=python3

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["npm", "run", "start"]
