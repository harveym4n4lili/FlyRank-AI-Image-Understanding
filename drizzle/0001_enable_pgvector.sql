-- pgvector must exist before any vector(768) column is created (next migration).
CREATE EXTENSION IF NOT EXISTS vector;
