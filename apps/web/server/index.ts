import { createApp } from './app';
import { resolveHost } from './lib/server-host';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = resolveHost();

createApp().listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST}:${PORT}`);
});
