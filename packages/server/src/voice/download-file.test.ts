import { lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { downloadVerifiedFile, VoiceDownloadFailure, type DownloadFileOptions } from './download-file';
import { fakeSource, sha256, startFakeHub, type FakeHub } from './testkit';

const PATH = '/test/repo/resolve/abc/file.bin';
const BODY = Buffer.from('0123456789abcdef'.repeat(64));

let dir: string;
let hub: FakeHub;
let files: Map<string, Buffer>;

beforeEach(async () => {
  dir = await makeTempDir('ai-office-dl-');
  files = new Map([[PATH, BODY]]);
  hub = await startFakeHub(files);
});
afterEach(async () => {
  await hub.close();
  await removeDir(dir);
});

function options(extra: Partial<DownloadFileOptions> = {}): DownloadFileOptions {
  return {
    url: new URL(`${hub.origin}${PATH}`),
    source: fakeSource(hub),
    partPath: join(dir, 'file.bin.part'),
    finalPath: join(dir, 'file.bin'),
    bytes: BODY.length,
    sha256: sha256(BODY),
    fetchImpl: fetch,
    signal: new AbortController().signal,
    onBytes: () => undefined,
    ...extra,
  };
}

const failureCode = async (promise: Promise<void>): Promise<string | undefined> =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof VoiceDownloadFailure ? error.code : `other:${String(error)}`),
  );

describe('downloadVerifiedFile', () => {
  test('writes the file under its final name, mode 0600, once the SHA-256 matches', async () => {
    const seen: number[] = [];

    await downloadVerifiedFile(options({ onBytes: (bytes) => seen.push(bytes) }));

    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
    expect((await stat(join(dir, 'file.bin'))).mode & 0o777).toBe(0o600);
    await expect(stat(join(dir, 'file.bin.part'))).rejects.toThrow();
    expect(seen.at(-1)).toBe(BODY.length);
  });

  test('refuses a file with another SHA-256 and deletes it', async () => {
    const code = await failureCode(downloadVerifiedFile(options({ sha256: sha256('other') })));

    expect(code).toBe('integrity');
    await expect(stat(join(dir, 'file.bin'))).rejects.toThrow();
    await expect(stat(join(dir, 'file.bin.part'))).rejects.toThrow();
  });

  test('continues a partial download from where it stopped', async () => {
    await writeFile(join(dir, 'file.bin.part'), BODY.subarray(0, 300));

    await downloadVerifiedFile(options());

    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
    expect(hub.requests.at(-1)?.range).toBe('bytes=300-');
  });

  test('starts over when the server ignores the range', async () => {
    await writeFile(join(dir, 'file.bin.part'), BODY.subarray(0, 300));
    hub.override(PATH, (_req, res, body) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    });

    await downloadVerifiedFile(options());

    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
  });

  test('never writes through a symbolic link left where the partial file goes', async () => {
    const outside = join(dir, 'outside.txt');
    await writeFile(outside, 'keep me');
    await symlink(outside, join(dir, 'file.bin.part'));

    await downloadVerifiedFile(options());

    expect(await readFile(outside, 'utf8')).toBe('keep me');
    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
    expect((await lstat(join(dir, 'file.bin'))).isFile()).toBe(true);
  });

  test('replaces a folder left where the partial file goes', async () => {
    await mkdir(join(dir, 'file.bin.part', 'inner'), { recursive: true });

    await downloadVerifiedFile(options());

    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
  });

  test('throws away a partial file that is longer than the real one', async () => {
    await writeFile(join(dir, 'file.bin.part'), Buffer.concat([BODY, Buffer.from('extra')]));

    await downloadVerifiedFile(options());

    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
  });

  test('verifies a complete partial file without asking the network', async () => {
    await writeFile(join(dir, 'file.bin.part'), BODY);

    await downloadVerifiedFile(options());

    expect(hub.requests).toEqual([]);
    expect(await readFile(join(dir, 'file.bin'))).toEqual(BODY);
  });

  test('follows a redirect inside the allowed hosts', async () => {
    const target = '/cdn/file.bin';
    files.set(target, BODY);
    hub.override(PATH, (_req, res) => {
      res.writeHead(302, { Location: target });
      res.end();
    });

    await downloadVerifiedFile(options());

    expect(hub.requests.map((request) => request.path)).toEqual([PATH, target]);
  });

  test('refuses a redirect to a host that is not allowed, before requesting it', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(302, { Location: 'http://example.invalid/evil.bin' });
      res.end();
    });
    const requested: string[] = [];
    const spy: typeof fetch = (input, init) => {
      requested.push(String(input));
      return fetch(input, init);
    };

    const code = await failureCode(downloadVerifiedFile(options({ fetchImpl: spy })));

    expect(code).toBe('network');
    expect(requested).toEqual([`${hub.origin}${PATH}`]);
  });

  test('gives up on a redirect loop', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(302, { Location: PATH });
      res.end();
    });

    expect(await failureCode(downloadVerifiedFile(options()))).toBe('network');
  });

  test('refuses a server answer that is not a success', async () => {
    files.delete(PATH);

    expect(await failureCode(downloadVerifiedFile(options()))).toBe('network');
  });

  test('refuses a file whose announced length is not the pinned size', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(200, { 'Content-Length': BODY.length + 10 });
      res.end(Buffer.concat([BODY, Buffer.alloc(10)]));
    });

    expect(await failureCode(downloadVerifiedFile(options()))).toBe('size');
  });

  test('refuses a stream that grows past the pinned size', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(200);
      res.write(BODY);
      res.end(Buffer.alloc(500));
    });

    expect(await failureCode(downloadVerifiedFile(options()))).toBe('size');
    await expect(stat(join(dir, 'file.bin'))).rejects.toThrow();
  });

  test('keeps what arrived when the transfer is cut, so the next try can continue', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(200, { 'Content-Length': BODY.length });
      res.write(BODY.subarray(0, 400));
      setTimeout(() => res.destroy(), 20);
    });

    expect(await failureCode(downloadVerifiedFile(options()))).toBe('network');
    expect((await stat(join(dir, 'file.bin.part'))).size).toBe(400);
  });

  test('times out a connection that goes quiet', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(200, { 'Content-Length': BODY.length });
      res.write(BODY.subarray(0, 100));
    });

    const code = await failureCode(downloadVerifiedFile(options({ idleTimeoutMs: 150 })));

    expect(code).toBe('timeout');
  });

  test('times out a server that never answers', async () => {
    hub.override(PATH, () => undefined);

    expect(await failureCode(downloadVerifiedFile(options({ connectTimeoutMs: 150 })))).toBe('timeout');
  });

  test('stops when cancelled', async () => {
    hub.override(PATH, (_req, res) => {
      res.writeHead(200, { 'Content-Length': BODY.length });
      res.write(BODY.subarray(0, 100));
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = downloadVerifiedFile(options({ signal: controller.signal }));

    await expect(result).rejects.not.toBeInstanceOf(VoiceDownloadFailure);
  });

  test('reports a folder it cannot write as a disk problem', async () => {
    await mkdir(join(dir, 'blocked'));
    const code = await failureCode(downloadVerifiedFile(options({ partPath: join(dir, 'blocked', 'nope', 'f.part') })));

    expect(code).toBe('disk');
  });
});
