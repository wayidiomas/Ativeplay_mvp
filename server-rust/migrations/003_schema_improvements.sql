-- Schema improvements migration
-- Fixes: item linking, TTL, deduplication, defaults, search, audit, multi-tenant

-- ============================================================================
-- 1. AUDIT TIMESTAMPS: Add created_at/updated_at to items, groups, series
-- ============================================================================

-- playlist_items
ALTER TABLE playlist_items
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- playlist_groups
ALTER TABLE playlist_groups
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- series
ALTER TABLE series
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- series_episodes
ALTER TABLE series_episodes
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================================================
-- 2. TTL/EXPIRATION: Add expires_at to playlists for cache management
-- ============================================================================

ALTER TABLE playlists
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_playlists_expires ON playlists(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- 3. SORT ORDER DEFAULT: Ensure sort_order has proper default
-- ============================================================================

ALTER TABLE playlist_items ALTER COLUMN sort_order SET DEFAULT 0;

-- ============================================================================
-- 4. ENHANCED SEARCH: Expand search_vector to include parsed_title and group_name
-- ============================================================================

-- Drop the old generated column and recreate with expanded fields
ALTER TABLE playlist_items DROP COLUMN IF EXISTS search_vector;

ALTER TABLE playlist_items
ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(parsed_title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(group_name, '')), 'C')
) STORED;

-- Recreate the GIN index
CREATE INDEX IF NOT EXISTS idx_items_search ON playlist_items USING gin(search_vector);

-- ============================================================================
-- 5. URL DEDUPLICATION: Add unique constraint on (playlist_id, url)
-- ============================================================================

-- First, remove any existing duplicates (keep the one with lowest sort_order)
DELETE FROM playlist_items a
USING playlist_items b
WHERE a.playlist_id = b.playlist_id
  AND a.url = b.url
  AND a.id > b.id;

-- Now add the unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_unique_url ON playlist_items(playlist_id, url);

-- ============================================================================
-- 6. EPISODE-ITEM LINKING: Populate item_id from item_hash lookup
-- ============================================================================

-- Update series_episodes to link item_id based on item_hash
UPDATE series_episodes
SET item_id = pi.id
FROM playlist_items pi, series s
WHERE s.id = series_episodes.series_id
  AND pi.playlist_id = s.playlist_id
  AND pi.item_hash = series_episodes.item_hash
  AND series_episodes.item_id IS NULL;

-- ============================================================================
-- 7. MULTI-TENANT INDEXES: Add indexes for client lookups
-- ============================================================================

-- Index for listing all groups by client (via playlist)
CREATE INDEX IF NOT EXISTS idx_groups_client ON playlist_groups(playlist_id);

-- Index for listing all series by client (via playlist)
CREATE INDEX IF NOT EXISTS idx_series_client ON series(playlist_id);

-- Composite index for client + media_kind queries on items
CREATE INDEX IF NOT EXISTS idx_items_client_kind ON playlist_items(playlist_id, media_kind);

-- ============================================================================
-- 8. UPDATE TRIGGERS: Add updated_at triggers for new timestamp columns
-- ============================================================================

CREATE TRIGGER update_items_updated_at
    BEFORE UPDATE ON playlist_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at
    BEFORE UPDATE ON playlist_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_series_updated_at
    BEFORE UPDATE ON series
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 9. CLEANUP HELPER: Function to delete expired playlists
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_playlists()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM playlists WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. STATS VIEW: Helpful view for monitoring
-- ============================================================================

CREATE OR REPLACE VIEW playlist_stats AS
SELECT
    p.id,
    p.hash,
    p.total_items,
    p.group_count,
    p.created_at,
    p.updated_at,
    p.expires_at,
    c.name as client_name,
    (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) as actual_items,
    (SELECT COUNT(*) FROM playlist_groups WHERE playlist_id = p.id) as actual_groups,
    (SELECT COUNT(*) FROM series WHERE playlist_id = p.id) as actual_series
FROM playlists p
LEFT JOIN clients c ON c.id = p.client_id;
