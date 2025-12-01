-- AtivePlay PostgreSQL Schema
-- Initial migration: Playlist storage with multi-tenancy support

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- Fuzzy search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";    -- UUID generation

-- ============================================================================
-- Clients (multi-tenancy)
-- ============================================================================
CREATE TABLE clients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id     VARCHAR(64) UNIQUE,
    name            VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Playlists (replaces CacheMetadata)
-- ============================================================================
CREATE TABLE playlists (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
    hash            VARCHAR(40) NOT NULL,
    url             TEXT NOT NULL,
    -- Stats
    total_items     INTEGER NOT NULL DEFAULT 0,
    live_count      INTEGER NOT NULL DEFAULT 0,
    movie_count     INTEGER NOT NULL DEFAULT 0,
    series_count    INTEGER NOT NULL DEFAULT 0,
    unknown_count   INTEGER NOT NULL DEFAULT 0,
    group_count     INTEGER NOT NULL DEFAULT 0,
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Unique per client+hash, or just hash if no client
    UNIQUE(client_id, hash)
);

-- Index for lookups without client
CREATE INDEX idx_playlists_hash ON playlists(hash);
CREATE INDEX idx_playlists_client ON playlists(client_id, hash);

-- ============================================================================
-- Playlist Groups
-- ============================================================================
CREATE TABLE playlist_groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playlist_id     UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    group_hash      VARCHAR(40) NOT NULL,
    name            VARCHAR(512) NOT NULL,
    media_kind      VARCHAR(16) NOT NULL,
    item_count      INTEGER NOT NULL DEFAULT 0,
    logo            TEXT,
    UNIQUE(playlist_id, group_hash)
);

CREATE INDEX idx_groups_playlist ON playlist_groups(playlist_id);
CREATE INDEX idx_groups_kind ON playlist_groups(playlist_id, media_kind);

-- ============================================================================
-- Playlist Items (replaces .ndjson files)
-- ============================================================================
CREATE TABLE playlist_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playlist_id     UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    item_hash       VARCHAR(64) NOT NULL,
    name            VARCHAR(1024) NOT NULL,
    url             TEXT NOT NULL,
    logo            TEXT,
    group_name      VARCHAR(512) NOT NULL,
    media_kind      VARCHAR(16) NOT NULL,
    -- Parsed title (denormalized for display)
    parsed_title    VARCHAR(1024),
    parsed_year     SMALLINT,
    parsed_quality  VARCHAR(16),
    -- Series fields
    series_id       VARCHAR(64),
    season_number   SMALLINT,
    episode_number  SMALLINT,
    -- Ordering
    sort_order      INTEGER NOT NULL,
    -- Full-text search vector (auto-generated)
    search_vector   tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(name, ''))
    ) STORED,
    UNIQUE(playlist_id, item_hash)
);

-- Items indexes (most common queries)
CREATE INDEX idx_items_playlist ON playlist_items(playlist_id);
CREATE INDEX idx_items_group ON playlist_items(playlist_id, group_name);
CREATE INDEX idx_items_kind ON playlist_items(playlist_id, media_kind);
CREATE INDEX idx_items_series ON playlist_items(playlist_id, series_id) WHERE series_id IS NOT NULL;
CREATE INDEX idx_items_order ON playlist_items(playlist_id, sort_order);

-- Full-text and fuzzy search indexes
CREATE INDEX idx_items_search ON playlist_items USING gin(search_vector);
CREATE INDEX idx_items_trgm ON playlist_items USING gin(name gin_trgm_ops);

-- Composite index for filtered pagination
CREATE INDEX idx_items_filter ON playlist_items(playlist_id, media_kind, group_name, sort_order);

-- ============================================================================
-- Series (aggregated from items)
-- ============================================================================
CREATE TABLE series (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playlist_id     UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    series_hash     VARCHAR(64) NOT NULL,
    name            VARCHAR(1024) NOT NULL,
    logo            TEXT,
    group_name      VARCHAR(512) NOT NULL,
    total_episodes  INTEGER NOT NULL DEFAULT 0,
    total_seasons   INTEGER NOT NULL DEFAULT 0,
    first_season    SMALLINT,
    last_season     SMALLINT,
    year            SMALLINT,
    quality         VARCHAR(16),
    UNIQUE(playlist_id, series_hash)
);

CREATE INDEX idx_series_playlist ON series(playlist_id);
CREATE INDEX idx_series_group ON series(playlist_id, group_name);

-- ============================================================================
-- Series Episodes (denormalized for fast access)
-- ============================================================================
CREATE TABLE series_episodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    series_id       UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    item_id         UUID REFERENCES playlist_items(id) ON DELETE CASCADE,
    item_hash       VARCHAR(64) NOT NULL,
    season          SMALLINT NOT NULL,
    episode         SMALLINT NOT NULL,
    name            VARCHAR(1024) NOT NULL,
    url             TEXT NOT NULL,
    UNIQUE(series_id, item_hash)
);

CREATE INDEX idx_episodes_series ON series_episodes(series_id);
CREATE INDEX idx_episodes_season ON series_episodes(series_id, season);

-- ============================================================================
-- Helper function for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_playlists_updated_at
    BEFORE UPDATE ON playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
