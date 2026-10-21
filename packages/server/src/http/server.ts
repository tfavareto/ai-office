// HTTP server: guard, router, API handlers and static files.
import { type Server, createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from './context';
import { API } from '@ai-office/shared';
import { registerDataRoutes } from './handlers/data';
import { registerGitRoutes } from './handlers/git';
import { registerHireRoutes } from './handlers/hire';
import { registerMessageRoutes } from './handlers/messages';
import { registerPermissionRoutes } from './handlers/permissions';
import { registerReportRoutes } from './handlers/report';
import { registerRuleRoutes } from './handlers/rules';
import { registerSystemRoutes } from './handlers/system';
import { registerUsageRoutes } from './handlers/usage';
import { guardRequest } from './guard';
import { HttpError, sendError } from './respond';
import { Router } from './router';
import { StaticServer } from './static';

/** Sent on every response (static files and API). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** A request must arrive completely within these limits (they do not apply to long-lived responses such as SSE). */
export const REQUEST_TIMEOUT_MS = 30_000;
export const HEADERS_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5000;

export interface HttpLimits {
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  /** How often Node enforces the two timeouts above (Node default: 30 s). */
  checkIntervalMs?: number;
}

export interface HttpServer {
  server: Server;
  statics: StaticServer;
}

export function buildRouter(app: AppContext): Router {
  const router = new Router();
  registerSystemRoutes(router, app);
  registerDataRoutes(router, app);
  registerUsageRoutes(router, app);
  registerPermissionRoutes(router, app);
  registerMessageRoutes(router, app);
  registerRuleRoutes(router, app);
  registerReportRoutes(router, app);
  registerHireRoutes(router, app);
  registerGitRoutes(router, app);
  return router;
}

export function createHttpServer(
  app: AppContext,
  statics = new StaticServer(app.config.webDir),
  limits: HttpLimits = { requestTimeoutMs: REQUEST_TIMEOUT_MS, headersTimeoutMs: HEADERS_TIMEOUT_MS },
): HttpServer {
  const router = buildRouter(app);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = guardRequest(req, { port: app.config.port, bindHost: app.config.host });
    if (!guard.ok) return sendError(res, guard.status, guard.error);
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const authed = app.auth.authorize(req);
      // Everything under /api needs the token, except health, which only reveals that a server is there.
      if (!authed && url.pathname !== API.health) return sendError(res, 401, 'unauthorized');
      const route = router.match(method, url.pathname);
      if (route === undefined) return sendError(res, 404, 'not-found');
      return void (await route.handler({ req, res, url, params: route.params, local: guard.local, authed }));
    }
    if (method === 'GET' || method === 'HEAD') {
      // Only pages opened on this computer get the session cookie. Remote browsers are not supported.
      const indexHeaders: Record<string, string> = guard.local ? { 'Set-Cookie': app.auth.cookie() } : {};
      return statics.handle(req, res, url.pathname, indexHeaders);
    }
    return sendError(res, 405, 'method-not-allowed');
  };

  const server = createServer({ connectionsCheckingInterval: limits.checkIntervalMs }, (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return sendError(res, error.status, error.message);
      app.log.error('Erro ao atender a requisição', error);
      if (!res.headersSent) sendError(res, 500, 'internal-error');
      else res.destroy();
    });
  });
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = limits.headersTimeoutMs;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  return { server, statics };
}
