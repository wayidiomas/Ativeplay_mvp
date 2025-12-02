-- Device TTL and Watch History Migration
-- Implements: single playlist per device, 1-day TTL, persistent watch history

-- ============================================================================
-- 1. DEVICE IDENTIFICATION: Add device_id to playlists
-- ============================================================================

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS device_id VARCHAR(64);

-- Index for device lookups
CREATE INDEX IF NOT EXISTS idx_playlists_device ON playlists(device_id);

-- Unique constraint: only one playlist per device
-- (partial index - only applies when device_id is not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_device_unique
ON playlists(device_id) WHERE device_id IS NOT NULL;

-- ============================================================================
-- 2. WATCH HISTORY: Persistent viewing history tied to device (not playlist)
-- ============================================================================

CREATE TABLE IF NOT EXISTS watch_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       VARCHAR(64) NOT NULL,
    item_hash       VARCHAR(64) NOT NULL,
    media_kind      VARCHAR(16) NOT NULL,
    name            VARCHAR(1024),
    logo            TEXT,
    position_ms     BIGINT NOT NULL DEFAULT 0,
    duration_ms     BIGINT,
    watched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Unique per device+item
    UNIQUE(device_id, item_hash)
);

-- Index for device lookups
CREATE INDEX IF NOT EXISTS idx_watch_history_device ON watch_history(device_id);

-- Index for recent history (for "Continue Watching" feature)
CREATE INDEX IF NOT EXISTS idx_watch_history_recent ON watch_history(device_id, watched_at DESC);

-- ============================================================================
-- 3. SET TTL ON EXISTING PLAYLISTS: Set 1-day TTL for playlists without expiration
-- ============================================================================

-- Update existing playlists that have no expiration to expire in 1 day
UPDATE playlists
SET expires_at = NOW() + INTERVAL '1 day'
WHERE expires_at IS NULL;

-- ============================================================================
-- 4. CLEANUP FUNCTION UPDATE: Ensure cleanup function exists
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
-- 5. WATCH HISTORY CLEANUP FUNCTION: Keep only recent entries per device
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_watch_history(keep_count INTEGER DEFAULT 100)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    device_rec RECORD;
BEGIN
    -- For each device, keep only the most recent N entries
    FOR device_rec IN SELECT DISTINCT device_id FROM watch_history LOOP
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY watched_at DESC) as rn
            FROM watch_history
            WHERE device_id = device_rec.device_id
        )
        DELETE FROM watch_history
        WHERE id IN (SELECT id FROM ranked WHERE rn > keep_count);

        GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;
    END LOOP;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
