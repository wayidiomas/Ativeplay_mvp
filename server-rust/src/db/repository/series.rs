//! Series repository

use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::db::models::{EpisodeRow, NewEpisode, NewSeries, SeriesRow};
use crate::models::playlist::{SeasonData, SeriesEpisode, SeriesInfo};

/// Insert or update a series
pub async fn upsert_series(pool: &PgPool, series: &NewSeries) -> Result<Uuid, sqlx::Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO series (playlist_id, series_hash, name, logo, group_name,
                           total_episodes, total_seasons, first_season, last_season, year, quality)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (playlist_id, series_hash) DO UPDATE SET
            name = EXCLUDED.name,
            logo = EXCLUDED.logo,
            group_name = EXCLUDED.group_name,
            total_episodes = EXCLUDED.total_episodes,
            total_seasons = EXCLUDED.total_seasons,
            first_season = EXCLUDED.first_season,
            last_season = EXCLUDED.last_season,
            year = EXCLUDED.year,
            quality = EXCLUDED.quality
        RETURNING id
        "#,
    )
    .bind(series.playlist_id)
    .bind(&series.series_hash)
    .bind(&series.name)
    .bind(&series.logo)
    .bind(&series.group_name)
    .bind(series.total_episodes)
    .bind(series.total_seasons)
    .bind(series.first_season)
    .bind(series.last_season)
    .bind(series.year)
    .bind(&series.quality)
    .fetch_one(pool)
    .await?;

    Ok(row.get("id"))
}

/// Bulk insert series
pub async fn insert_many(
    pool: &PgPool,
    series_list: &[NewSeries],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let mut ids = Vec::with_capacity(series_list.len());

    for series in series_list {
        let id = upsert_series(pool, series).await?;
        ids.push(id);
    }

    Ok(ids)
}

/// Get all series for a playlist
pub async fn get_by_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<Vec<SeriesRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT id, playlist_id, series_hash, name, logo, group_name,
               total_episodes, total_seasons, first_season, last_season, year, quality
        FROM series
        WHERE playlist_id = $1
        ORDER BY name
        "#,
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get series filtered by group
pub async fn get_by_group(
    pool: &PgPool,
    playlist_id: Uuid,
    group_name: &str,
) -> Result<Vec<SeriesRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT id, playlist_id, series_hash, name, logo, group_name,
               total_episodes, total_seasons, first_season, last_season, year, quality
        FROM series
        WHERE playlist_id = $1 AND group_name = $2
        ORDER BY name
        "#,
    )
    .bind(playlist_id)
    .bind(group_name)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get a single series by hash
pub async fn get_by_hash(
    pool: &PgPool,
    playlist_id: Uuid,
    series_hash: &str,
) -> Result<Option<SeriesRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT id, playlist_id, series_hash, name, logo, group_name,
               total_episodes, total_seasons, first_season, last_season, year, quality
        FROM series
        WHERE playlist_id = $1 AND series_hash = $2
        "#,
    )
    .bind(playlist_id)
    .bind(series_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Get series by database ID
pub async fn get_by_id(pool: &PgPool, series_id: Uuid) -> Result<Option<SeriesRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT id, playlist_id, series_hash, name, logo, group_name,
               total_episodes, total_seasons, first_season, last_season, year, quality
        FROM series
        WHERE id = $1
        "#,
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Delete all series for a playlist
pub async fn delete_by_playlist(pool: &PgPool, playlist_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM series WHERE playlist_id = $1")
        .bind(playlist_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

// ============================================================================
// Episodes
// ============================================================================

/// Insert an episode
pub async fn insert_episode(pool: &PgPool, episode: &NewEpisode) -> Result<Uuid, sqlx::Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO series_episodes (series_id, item_id, item_hash, season, episode, name, url)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (series_id, item_hash) DO UPDATE SET
            season = EXCLUDED.season,
            episode = EXCLUDED.episode,
            name = EXCLUDED.name,
            url = EXCLUDED.url
        RETURNING id
        "#,
    )
    .bind(episode.series_id)
    .bind(episode.item_id)
    .bind(&episode.item_hash)
    .bind(episode.season)
    .bind(episode.episode)
    .bind(&episode.name)
    .bind(&episode.url)
    .fetch_one(pool)
    .await?;

    Ok(row.get("id"))
}

/// Bulk insert episodes
pub async fn insert_many_episodes(
    pool: &PgPool,
    episodes: &[NewEpisode],
) -> Result<usize, sqlx::Error> {
    let mut count = 0;

    for episode in episodes {
        insert_episode(pool, episode).await?;
        count += 1;
    }

    Ok(count)
}

/// Get episodes for a series
pub async fn get_episodes(pool: &PgPool, series_id: Uuid) -> Result<Vec<EpisodeRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, EpisodeRow>(
        r#"
        SELECT id, series_id, item_id, item_hash, season, episode, name, url
        FROM series_episodes
        WHERE series_id = $1
        ORDER BY season, episode
        "#,
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get episodes for a specific season
pub async fn get_episodes_by_season(
    pool: &PgPool,
    series_id: Uuid,
    season: i16,
) -> Result<Vec<EpisodeRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, EpisodeRow>(
        r#"
        SELECT id, series_id, item_id, item_hash, season, episode, name, url
        FROM series_episodes
        WHERE series_id = $1 AND season = $2
        ORDER BY episode
        "#,
    )
    .bind(series_id)
    .bind(season)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get series with episodes grouped by season
pub async fn get_series_with_episodes(
    pool: &PgPool,
    playlist_id: Uuid,
    series_hash: &str,
) -> Result<Option<SeriesInfo>, sqlx::Error> {
    // Get series
    let series_row = match get_by_hash(pool, playlist_id, series_hash).await? {
        Some(row) => row,
        None => return Ok(None),
    };

    // Get episodes
    let episode_rows = get_episodes(pool, series_row.id).await?;

    // Group episodes by season
    let mut seasons_map: std::collections::BTreeMap<u8, Vec<SeriesEpisode>> =
        std::collections::BTreeMap::new();

    for row in episode_rows {
        let episode = SeriesEpisode::from(row.clone());
        seasons_map
            .entry(row.season as u8)
            .or_default()
            .push(episode);
    }

    // Convert to SeasonData
    let seasons_data: Vec<SeasonData> = seasons_map
        .into_iter()
        .map(|(season_number, mut episodes)| {
            episodes.sort_by_key(|e| e.episode);
            SeasonData {
                season_number,
                episodes,
            }
        })
        .collect();

    // Build SeriesInfo
    let mut series_info = SeriesInfo::from(series_row);
    series_info.seasons_data = if seasons_data.is_empty() {
        None
    } else {
        Some(seasons_data)
    };

    Ok(Some(series_info))
}

/// Count series for a playlist
pub async fn count_by_playlist(pool: &PgPool, playlist_id: Uuid) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM series WHERE playlist_id = $1")
        .bind(playlist_id)
        .fetch_one(pool)
        .await?;

    Ok(row.0)
}

/// Convert SeriesInfo to NewSeries
pub fn from_series_info(series: &SeriesInfo, playlist_id: Uuid) -> NewSeries {
    NewSeries::from_series_info(series, playlist_id)
}
