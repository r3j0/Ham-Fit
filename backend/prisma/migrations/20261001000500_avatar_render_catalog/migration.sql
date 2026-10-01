CREATE TABLE avatar_render_catalogs (
  id TEXT PRIMARY KEY CHECK (id = 'wardrobe'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  catalog JSONB NOT NULL CHECK (jsonb_typeof(catalog) = 'object'),
  source_catalog JSONB NOT NULL CHECK (jsonb_typeof(source_catalog) = 'object'),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
