import { Response } from 'express';
import { Issue } from '@camtom/shared';

interface SSEClient {
  id: string;
  res: Response;
}

interface DeltaPayload {
  added?: Issue[];
  updated?: Issue[];
  removed?: string[];
  serverTime: number;
  assignmentTimestamps?: Record<string, string>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

class SSEManager {
  private clients: SSEClient[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;

  addClient(id: string, res: Response): void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    const client: SSEClient = { id, res };
    this.clients.push(client);

    console.log(`[sse] Client ${id} connected (${this.clients.length} total)`);

    // Clean up on disconnect
    res.on('close', () => {
      this.removeClient(id);
    });
  }

  removeClient(id: string): void {
    this.clients = this.clients.filter((c) => c.id !== id);
    console.log(`[sse] Client ${id} disconnected (${this.clients.length} remaining)`);

    if (this.clients.length === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  broadcast(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const deadClients: string[] = [];

    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        deadClients.push(client.id);
      }
    }

    // Clean up dead clients
    for (const id of deadClients) {
      this.removeClient(id);
    }
  }

  broadcastDelta(payload: DeltaPayload): void {
    this.broadcast('delta', payload);
  }

  broadcastHeartbeat(): void {
    this.broadcast('heartbeat', { serverTime: Date.now() });
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  get clientCount(): number {
    return this.clients.length;
  }
}

export const sseManager = new SSEManager();
export { SSEManager };
