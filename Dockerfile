# Cloud Run image: the dashboard plus its API, and the BigQuery refresh job.
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ server/
COPY scripts/ scripts/
COPY docs/ docs/
ENV PORT=8080 PYTHONUNBUFFERED=1
CMD exec gunicorn --chdir server --bind :$PORT --workers 1 --threads 8 --timeout 60 main:app
