FROM python:3.13-slim

WORKDIR /app

COPY requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt

COPY mmcp_core/ mmcp_core/
COPY mmcp_cloud/ mmcp_cloud/
COPY pyproject.toml .
COPY LICENSE .

RUN pip install -e .

EXPOSE 8765

CMD ["uvicorn", "mmcp_cloud.server:app", "--host", "0.0.0.0", "--port", "8765"]
