-- Fix group_hash column size
-- The group ID format is "group_" (6 chars) + SHA1 hash (40 chars) = 46 chars
-- Extending to 64 chars for safety margin

ALTER TABLE playlist_groups ALTER COLUMN group_hash TYPE VARCHAR(64);
