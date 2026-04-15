module.exports = {
  apps: [
    {
      name: 'alpha-daily-scan',
      script: 'src/scanner/run-scan.js',
      cwd: __dirname,
      interpreter: 'node',
      cron_restart: '0 2 * * *', // 02:00 UTC daily
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
