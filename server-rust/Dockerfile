# ==========================================
# Stage 1: Build the Rust application
# ==========================================
FROM rust:1.75-slim-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create a new empty shell project
WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock* ./

# Create dummy src/main.rs to build dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build only dependencies (this step is cached)
RUN cargo build --release && rm -rf src target/release/deps/ativeplay*

# Now copy the actual source code
COPY src ./src

# Build the actual application
RUN cargo build --release

# ==========================================
# Stage 2: Create minimal runtime image
# ==========================================
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser

WORKDIR /app

# Copy the compiled binary
COPY --from=builder /app/target/release/ativeplay-server /app/ativeplay-server

# Create cache directory
RUN mkdir -p /app/.parse-cache && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Set environment variables
ENV PORT=3001
ENV NODE_ENV=production
ENV PARSE_CACHE_DIR=/app/.parse-cache
ENV RUST_LOG=info

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Run the application
CMD ["/app/ativeplay-server"]
