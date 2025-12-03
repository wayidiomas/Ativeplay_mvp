-- Xtream-Only Cleanup Migration
-- Removes M3U-specific tables that are not needed for Xtream mode
-- Xtream fetches all data directly from the API, no local storage needed

-- ============================================================================
-- 1. DROP M3U-SPECIFIC TABLES (data comes from Xtream API)
-- ============================================================================

-- Drop series_episodes first (depends on series and playlist_items)
DROP TABLE IF EXISTS series_episodes CASCADE;

-- Drop series table (Xtream gets series from API)
DROP TABLE IF EXISTS series CASCADE;

-- Drop playlist_items (Xtream gets streams from API)
DROP TABLE IF EXISTS playlist_items CASCADE;

-- Drop playlist_groups (Xtream gets categories from API)
DROP TABLE IF EXISTS playlist_groups CASCADE;

-- ============================================================================
-- 2. DROP M3U-SPECIFIC EXTENSIONS (no longer needed)
-- ============================================================================

-- pg_trgm was used for fuzzy search on playlist_items
-- Keep it if other things might use it, or drop if not needed
-- DROP EXTENSION IF EXISTS pg_trgm;

-- ============================================================================
-- 3. UPDATE PLAYLIST_STATS VIEW (remove references to dropped tables)
-- ============================================================================

DROP VIEW IF EXISTS playlist_stats;

CREATE VIEW playlist_stats AS
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
    c.name as client_name
FROM playlists p
LEFT JOIN clients c ON c.id = p.client_id;

-- ============================================================================
-- 4. CLEANUP: Remove M3U count columns (optional - keep for stats display)
-- ============================================================================

-- We keep live_count, movie_count, series_count as they can still be populated
-- from Xtream API response for display purposes

-- ============================================================================
-- 5. SET DEFAULT SOURCE TYPE TO XTREAM for new playlists
-- ============================================================================

ALTER TABLE playlists ALTER COLUMN source_type SET DEFAULT 'xtream';

-- ============================================================================
-- SUMMARY: Tables remaining after cleanup
-- ============================================================================
-- - playlists: Store Xtream credentials and metadata
-- - clients: Multi-tenancy support (optional)
-- - watch_history: Persistent viewing history per device
