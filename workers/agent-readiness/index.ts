import { route } from "./router.ts";
import type { Env } from "./http.ts";

type Context = { passThroughOnException(): void };

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    return route(request, env, {
      // The static files of this deployment. Site content never comes from
      // the global fetch: there is no server behind this Worker.
      originFetch: (assetRequest) => env.ASSETS.fetch(assetRequest),
      passThrough: () => ctx.passThroughOnException(),
      now: () => Date.now(),
      log: (line) => console.log(line),
    });
  },
};
