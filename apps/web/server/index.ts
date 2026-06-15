import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3001);

createApp().listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
