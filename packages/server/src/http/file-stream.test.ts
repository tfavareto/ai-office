import { writeFile } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { streamFile } from './file-stream';

const SIZE = 8 * 1024 * 1024;

let dir: string;
let path: string;
let server: Server;
let streams: ReadStream[];

async function serve(target: string): Promise<number> {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': SIZE });
    streams.push(streamFile(res, target, { start: 0, end: SIZE - 1 }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

beforeEach(async () => {
  dir = await makeTempDir('ai-office-stream-');
  path = join(dir, 'big.bin');
  await writeFile(path, Buffer.alloc(SIZE, 7));
  streams = [];
});
afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await removeDir(dir);
});

describe('streamFile', () => {
  test('sends the whole file and closes it', async () => {
    const port = await serve(path);

    const body = await (await fetch(`http://127.0.0.1:${port}/`)).arrayBuffer();

    expect(body.byteLength).toBe(SIZE);
    await expect.poll(() => streams[0]?.destroyed).toBe(true);
  });

  test('closes the file when the reader goes away halfway', async () => {
    const port = await serve(path);

    await new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? resolve() : reject(error)));
      req.end();
    });

    await expect.poll(() => streams[0]?.destroyed, { timeout: 5000 }).toBe(true);
    expect(streams[0]?.bytesRead).toBeLessThan(SIZE);
  });

  test('ends the response when the file cannot be read', async () => {
    const port = await serve(join(dir, 'missing.bin'));

    await expect(fetch(`http://127.0.0.1:${port}/`).then((res) => res.arrayBuffer())).rejects.toThrow();
    await expect.poll(() => streams[0]?.destroyed).toBe(true);
  });
});
