import { Env } from './types';

export default {
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Replaced with the real pipeline in Task 15.
  },

  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response('ok');
  },
};
