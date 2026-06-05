ALTER TABLE events
  ADD COLUMN embedding vector(1536),
  ADD COLUMN embedding_model text;
