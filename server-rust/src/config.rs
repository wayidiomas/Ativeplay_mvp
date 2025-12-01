use std::env;

/// Application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    // Server
    pub port: u16,
    pub node_env: String,
    pub base_url: String,

    // Redis
    pub redis_url: String,

    // PostgreSQL
    pub database_url: String,
    pub db_max_connections: u32,

    // Parsing
    pub parse_cache_ttl_ms: u64,
    pub max_m3u_size_mb: usize,
    pub fetch_timeout_ms: u64,
    pub max_items_page: usize,
    pub max_retries: u32,

    // HLS Proxy
    pub hls_proxy_timeout_ms: u64,

    // Cache
    pub parse_cache_dir: String,
    pub parse_cache_max_entries: Option<usize>,
    pub parse_cache_max_mb: Option<u64>,

    // Session
    pub session_ttl_seconds: u64,

    // Misc
    pub user_agent: String,
}

impl Config {
    /// Load configuration from environment variables with defaults
    pub fn from_env() -> Self {
        Self {
            // Server
            port: env::var("PORT")
                .unwrap_or_else(|_| "3001".to_string())
                .parse()
                .unwrap_or(3001),
            node_env: env::var("NODE_ENV").unwrap_or_else(|_| "development".to_string()),
            base_url: env::var("BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3001".to_string()),

            // Redis
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),

            // PostgreSQL
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://localhost/ativeplay".to_string()),
            db_max_connections: env::var("DB_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "15".to_string())
                .parse()
                .unwrap_or(15),

            // Parsing
            parse_cache_ttl_ms: env::var("PARSE_CACHE_TTL_MS")
                .unwrap_or_else(|_| "600000".to_string())
                .parse()
                .unwrap_or(600_000), // 10 minutes

            max_m3u_size_mb: env::var("MAX_M3U_SIZE_MB")
                .unwrap_or_else(|_| "500".to_string())
                .parse()
                .unwrap_or(500),

            fetch_timeout_ms: env::var("FETCH_TIMEOUT_MS")
                .unwrap_or_else(|_| "300000".to_string())
                .parse()
                .unwrap_or(300_000), // 5 minutes

            max_items_page: env::var("MAX_ITEMS_PAGE")
                .unwrap_or_else(|_| "5000".to_string())
                .parse()
                .unwrap_or(5000),

            max_retries: env::var("MAX_RETRIES")
                .unwrap_or_else(|_| "3".to_string())
                .parse()
                .unwrap_or(3),

            // HLS Proxy
            hls_proxy_timeout_ms: env::var("HLS_PROXY_TIMEOUT_MS")
                .unwrap_or_else(|_| "15000".to_string())
                .parse()
                .unwrap_or(15_000), // 15 seconds

            // Cache
            parse_cache_dir: env::var("PARSE_CACHE_DIR")
                .unwrap_or_else(|_| ".parse-cache".to_string()),
            parse_cache_max_entries: env::var("PARSE_CACHE_MAX_ENTRIES")
                .ok()
                .and_then(|v| v.parse().ok()),
            parse_cache_max_mb: env::var("PARSE_CACHE_MAX_MB")
                .ok()
                .and_then(|v| v.parse().ok()),

            // Session
            session_ttl_seconds: env::var("SESSION_TTL_SECONDS")
                .unwrap_or_else(|_| "900".to_string())
                .parse()
                .unwrap_or(900), // 15 minutes

            // Misc - Use VLC user agent to avoid IPTV server blocks
            user_agent: env::var("USER_AGENT")
                .unwrap_or_else(|_| "VLC/3.0.20 LibVLC/3.0.20".to_string()),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::from_env()
    }
}
