// Static file server for the built web app (packages/web/dist): MIME types, cache headers, SPA fallback.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fnv1a } from '@ai-office/shared';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const MISSING_NOTE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>AI Office</title>
<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1>AI Office</h1><p>O servidor está no ar, mas o app web ainda não foi compilado.</p>
<p>Rode <code>npm run build</code> e recarregue esta página (ou use <code>npm run dev</code>).</p></body></html>`;

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Absolute file path inside `root` for a URL path, or undefined when it would escape the root. */
export function resolveInside(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const full = normalize(join(root, decoded));
  return full === root || full.startsWith(root + sep) ? full : undefined;
}

export class StaticServer {
  private cachedBuild: { mtime: number; id: string } | undefined;

  constructor(private readonly root: string) {}

  /** Id of the served web build (hash of index.html, which references the hashed assets). */
  async buildId(): Promise<string | undefined> {
    const index = join(this.root, 'index.html');
    try {
      const info = await stat(index);
      if (this.cachedBuild?.mtime !== info.mtimeMs) {
        this.cachedBuild = { mtime: info.mtimeMs, id: fnv1a(await readFile(index, 'utf8')).toString(16) };
      }
      return this.cachedBuild.id;
    } catch {
      return undefined;
    }
  }

  /** `indexHeaders` are added to responses that serve index.html (the session cookie). */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    indexHeaders: Record<string, string> = {},
  ): Promise<void> {
    const head = req.method === 'HEAD';
    const target = resolveInside(this.root, pathname === '/' ? '/index.html' : pathname);
    if (target === undefined) return this.reply(res, 400, 'text/plain; charset=utf-8', 'Caminho inválido', head);
    const file = await this.findFile(target, pathname);
    if (file === undefined) {
      const missingRoot = (await this.buildId()) === undefined;
      if (missingRoot) return this.reply(res, 200, 'text/html; charset=utf-8', MISSING_NOTE, head);
      return this.reply(res, 404, 'text/plain; charset=utf-8', 'Não encontrado', head);
    }
    res.writeHead(200, {
      'Content-Type': mimeFor(file.path),
      'Content-Length': file.size,
      'Cache-Control': this.cacheControl(file.path),
      ...(file.path === join(this.root, 'index.html') ? indexHeaders : {}),
    });
    if (head) {
      res.end();
      return;
    }
    createReadStream(file.path)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  private async findFile(target: string, pathname: string): Promise<{ path: string; size: number } | undefined> {
    const direct = await this.fileInfo(target);
    if (direct !== undefined) return direct;
    const looksLikeAsset = extname(pathname) !== '' || pathname.startsWith('/api/');
    if (looksLikeAsset) return undefined;
    return this.fileInfo(join(this.root, 'index.html'));
  }

  private async fileInfo(path: string): Promise<{ path: string; size: number } | undefined> {
    try {
      const info = await stat(path);
      return info.isFile() ? { path, size: info.size } : undefined;
    } catch {
      return undefined;
    }
  }

  private cacheControl(path: string): string {
    if (path.endsWith('index.html')) return 'no-cache';
    if (path.includes(`${sep}assets${sep}`) && /-[A-Za-z0-9_-]{6,}\./.test(path))
      return 'public, max-age=31536000, immutable';
    return 'public, max-age=3600';
  }

  private reply(res: ServerResponse, status: number, type: string, body: string, head: boolean): void {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
    });
    res.end(head ? undefined : body);
  }
}
