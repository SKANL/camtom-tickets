/**
 * Vercel Serverless Function entry point.
 *
 * This file is used by Vercel's @vercel/node runtime when deployed.
 * The Express app is created and initialized on cold start, then
 * handled by Vercel's serverless adapter.
 */
import { createApp, initServer } from '../server/dist/app';

const app = createApp();
initServer();

export default app;
