// Tiny router: method + path pattern with `:param` segments.
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Loopback bind + loopback Host + loopback peer. */
  local: boolean;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
  }

  /** Returns the handler and params for a request, or undefined when no route matches. */
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const matches = route.segments.every((segment, i) => {
        const part = parts[i] as string;
        if (!segment.startsWith(':')) return segment === part;
        try {
          params[segment.slice(1)] = decodeURIComponent(part);
          return true;
        } catch {
          return false;
        }
      });
      if (matches) return { handler: route.handler, params };
    }
    return undefined;
  }
}
