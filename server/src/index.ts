import { createApp, initServer } from './app';
import { getConfig } from './config';

const PORT = parseInt(process.env.PORT || '3001', 10);

const app = createApp();
initServer();

app.listen(PORT, () => {
  console.log(`[server] Camtom Tickets API running on http://localhost:${PORT}`);
  console.log(`[server] Dashboard title: "${getConfig().dashboard.title}"`);
});

export { app };
