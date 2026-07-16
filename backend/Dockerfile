FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# Build deps for asyncmy (MySQL client) then clean up.
RUN apt-get update && apt-get install -y --no-install-recommends gcc default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Single worker by design (in-memory transfer state — §0).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
