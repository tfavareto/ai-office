// Helpers for the team tests: two framed connections over a real loopback socket, and fast stretching.
import { type Server, type Socket, connect, createServer } from 'node:net';
import { FramedConn } from './conn';
import { HANDSHAKE_MAX_BYTES } from './limits';

export interface Pair {
  client: FramedConn;
  server: FramedConn;
  rawClient: Socket;
  rawServer: Socket;
  close(): Promise<void>;
}

export async function connectedPair(maxBytes = HANDSHAKE_MAX_BYTES): Promise<Pair> {
  const listener: Server = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const accepted = new Promise<Socket>((resolve) => listener.once('connection', resolve));
  const rawClient = connect(port, '127.0.0.1');
  const rawServer = await accepted;
  const client = new FramedConn(rawClient, maxBytes);
  const server = new FramedConn(rawServer, maxBytes);
  return {
    client,
    server,
    rawClient,
    rawServer,
    close: async () => {
      client.destroy();
      server.destroy();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
}

/** A relay between two connections that may rewrite the frames it forwards (a machine in the middle). */
export function relay(
  from: FramedConn,
  to: FramedConn,
  rewrite: (frame: Buffer, index: number) => Buffer | null = (frame) => frame,
): void {
  let index = 0;
  const pump = async (): Promise<void> => {
    for (;;) {
      let frame: Buffer;
      try {
        frame = await from.read(5000);
      } catch {
        to.close();
        return;
      }
      const out = rewrite(frame, index++);
      if (out !== null) to.send(out);
    }
  };
  void pump();
}
