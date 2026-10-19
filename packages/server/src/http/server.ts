// HTTP server: guard, router, API handlers and static files.
import { type Server, createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from './context';
import { registerDataRoutes } from './handlers/data';
import { registerMessageRoutes } from './handlers/messages';
import { registerPermissionRoutes } from './handlers/permissions';
import { registerSystemRoutes } from './handlers/system';
import { guardRequest } from './guard';
import { HttpError, sendError } from './respond';
import { Router } from './router';
import { StaticServer } from './static';

export interface HttpServer {
  server: Server;
  statics: StaticServer;
}

export function buildRouter(app: AppContext): Router {
  const router = new Router();
  registerSystemRoutes(router, app);
  registerDataRoutes(router, app);
  registerPermissionRoutes(router, app);
  registerMessageRoutes(router, app);
  return router;
}

export function createHttpServer(app: AppContext, statics = new StaticServer(app.config.webDir)): HttpServer {
  const router = buildRouter(app);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const guard = guardRequest(req, { port: app.config.port, bindHost: app.config.host });
    if (!guard.ok) return sendError(res, guard.status, guard.error);
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = router.match(method, url.pathname);
    if (route !== undefined) return void (await route.handler({ req, res, url, params: route.params, local: guard.local }));
    if (url.pathname.startsWith('/api/')) return sendError(res, 404, 'not-found');
    if (method === 'GET' || method === 'HEAD') return statics.handle(req, res, url.pathname);
    return sendError(res, 405, 'method-not-allowed');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return sendError(res, error.status, error.message);
      app.log.error('Erro ao atender a requisição', error);
      if (!res.headersSent) sendError(res, 500, 'internal-error');
      else res.destroy();
    });
  });
  server.requestTimeout = 0;
  server.keepAliveTimeout = 5000;
  return { server, statics };
}
