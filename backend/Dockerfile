FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml backend/README.md ./
COPY backend/app ./app
COPY backend/scripts ./scripts
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic

RUN pip install --no-cache-dir -U pip \
    && pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
ENV GCODE_UPLOAD_DIR=/app/data/uploads

RUN mkdir -p /app/data/uploads

EXPOSE 8000

CMD sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"
