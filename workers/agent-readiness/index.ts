import { handle } from "./handler.ts";

type Context = { passThroughOnException(): void };

export default {
  async fetch(request: Request, _env: unknown, ctx: Context): Promise<Response> {
    // Last line of defense: an uncaught exception forwards the request to the origin.
    ctx.passThroughOnException();
    try {
      return await handle(request, (originRequest) => fetch(originRequest));
    } catch (error) {
      // Fail open: serve whatever GitHub Pages serves, undecorated.
      console.error("agent-readiness failed open:", String(error));
      return fetch(request);
    }
  },
};
