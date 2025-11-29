/**
 * PM2 Ecosystem Config
 * Roda API Server e Worker como processos separados
 *
 * Comandos:
 * - pm2 start ecosystem.config.cjs
 * - pm2 logs
 * - pm2 monit
 * - pm2 stop all
 * - pm2 restart all
 */

module.exports = {
  apps: [
    {
      name: 'ativeplay-api',
      script: './api-server.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=1024', // Increased to 1GB for large meta.json parsing
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001,
      },
      max_memory_restart: '1200M', // Restart se passar de 1200 MB
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false, // Não watch em produção
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'ativeplay-worker',
      script: './worker.js',
      instances: 1, // ⭐ 1 worker com concurrency=2 internamente
      exec_mode: 'fork',
      node_args: '--max-old-space-size=800 --expose-gc', // Worker pesado, 800 MB RAM + GC manual
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '900M', // Restart se passar de 900 MB
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 30000, // 30s para terminar jobs em andamento antes de kill
    },
  ],
};
