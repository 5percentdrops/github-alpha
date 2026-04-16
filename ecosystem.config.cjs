module.exports = {
  apps: [
    {
      name: 'alpha-api',
      script: 'src/api/server.js',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3847,
      },
    },
    {
      name: 'alpha-daily-scan',
      script: 'src/scanner/run-scan.js',
      cwd: __dirname,
      interpreter: 'node',
      cron_restart: '0 11 * * *', // 11:00 UTC daily
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'alpha-hot-rescan',
      script: 'src/scanner/run-scan.js',
      args: '--hot-only',
      cwd: __dirname,
      interpreter: 'node',
      cron_restart: '0 */6 * * *', // every 6 hours
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
