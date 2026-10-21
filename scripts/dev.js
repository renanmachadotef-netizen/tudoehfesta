// Sobe API (porta 3001) e Vite (porta 5173) juntos para desenvolvimento.
import { spawn } from 'node:child_process';

const run = (cmd, args, env = {}) =>
  spawn(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });

run('node', ['scripts/copy-models.js']).on('exit', () => {
  run('node', ['--watch', 'server/index.js'], { PORT: '3001' });
  run('npx', ['vite']);
});
