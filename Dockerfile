FROM python:3.13-slim

WORKDIR /app

# Copy requirements and install deps (layer cache)
COPY python/requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt

# Copy source code from python/ subdirectory
COPY python/mmcp_core/ mmcp_core/
COPY python/mmcp_cloud/ mmcp_cloud/
COPY python/langchain_mmcp/ langchain_mmcp/
COPY python/pyproject.toml pyproject.toml
COPY python/LICENSE LICENSE
COPY python/README.md README.md

# Install the package
RUN pip install --no-cache-dir -e .

# Railway sets $PORT automatically
ENV PORT=8765
EXPOSE 8765

CMD uvicorn mmcp_cloud.server:app --host 0.0.0.0 --port $PORT
