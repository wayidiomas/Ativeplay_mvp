-- Xtream Codes Support Migration
-- Implements: hybrid M3U/Xtream architecture with source type detection

-- ============================================================================
-- 1. SOURCE TYPE: Enum to distinguish M3U vs Xtream playlists
-- ============================================================================

-- Create enum type for source type
DO $$ BEGIN
    CREATE TYPE playlist_source_type AS ENUM ('m3u', 'xtream');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Add source_type column with default 'm3u' (existing playlists are M3U)
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS source_type playlist_source_type DEFAULT 'm3u';

-- ============================================================================
-- 2. PLAYLIST NAME: Display name for the playlist
-- ============================================================================

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS name VARCHAR(512);

-- Set default name for existing playlists based on hash
UPDATE playlists SET name = 'M3U Playlist' WHERE name IS NULL;

-- ============================================================================
-- 3. XTREAM CREDENTIALS: Store server, username, password for Xtream sources
-- ============================================================================

-- Server URL (e.g., "http://example.com:8080")
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS xtream_server VARCHAR(512);

-- Username for Xtream authentication
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS xtream_username VARCHAR(256);

-- Password for Xtream authentication
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS xtream_password VARCHAR(256);

-- ============================================================================
-- 4. XTREAM ACCOUNT INFO: Optional metadata from Xtream auth response
-- ============================================================================

-- Account expiration date (from user_info.exp_date)
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS xtream_expires_at TIMESTAMPTZ;

-- Max connections allowed (from user_info.max_connections)
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS xtream_max_connections SMALLINT;

-- Is trial account (from user_info.is_trial)
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS xtream_is_trial BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 5. INDEXES: Optimize queries for Xtream playlists
-- ============================================================================

-- Index for source type filtering
CREATE INDEX IF NOT EXISTS idx_playlists_source_type ON playlists(source_type);

-- Index for Xtream credential lookups (to check if same credentials already exist)
CREATE INDEX IF NOT EXISTS idx_playlists_xtream_creds
ON playlists(xtream_server, xtream_username)
WHERE source_type = 'xtream';

-- ============================================================================
-- 6. STATS VIEW UPDATE: Include source_type in playlist_stats view
-- ============================================================================

CREATE OR REPLACE VIEW playlist_stats AS
SELECT
    p.id,
    p.hash,
    p.name,
    p.source_type,
    p.total_items,
    p.group_count,
    p.created_at,
    p.updated_at,
    p.expires_at,
    p.device_id,
    p.xtream_server,
    p.xtream_expires_at,
    c.name as client_name,
    (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) as actual_items,
    (SELECT COUNT(*) FROM playlist_groups WHERE playlist_id = p.id) as actual_groups,
    (SELECT COUNT(*) FROM series WHERE playlist_id = p.id) as actual_series
FROM playlists p
LEFT JOIN clients c ON c.id = p.client_id;

-- ============================================================================
-- 7. HELPER FUNCTION: Check if Xtream credentials already exist
-- ============================================================================

CREATE OR REPLACE FUNCTION find_xtream_by_credentials(
    p_server VARCHAR(512),
    p_username VARCHAR(256)
) RETURNS TABLE (
    id UUID,
    name VARCHAR(512),
    expires_at TIMESTAMPTZ,
    xtream_expires_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pl.id,
        pl.name,
        pl.expires_at,
        pl.xtream_expires_at
    FROM playlists pl
    WHERE pl.source_type = 'xtream'
      AND pl.xtream_server = p_server
      AND pl.xtream_username = p_username
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;
