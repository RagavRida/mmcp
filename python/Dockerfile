FROM python:3.13-slim

WORKDIR /app

# Install dependencies first (for layer caching)
COPY requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt

# Copy source code
COPY mmcp_core/ mmcp_core/
COPY mmcp_cloud/ mmcp_cloud/
COPY langchain_mmcp/ langchain_mmcp/
COPY pyproject.toml pyproject.toml
COPY LICENSE LICENSE
COPY README.md README.md

# Install the package
RUN pip install --no-cache-dir -e .

# Port from environment (Railway sets $PORT)
ENV PORT=8765
EXPOSE 8765

CMD uvicorn mmcp_cloud.server:app --host 0.0.0.0 --port $PORT
