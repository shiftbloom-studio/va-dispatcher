import type {
  ExecutionContext,
  ScheduledController,
} from "@cloudflare/workers-types";
import app from "./app.js";
import { bindPlatform, type WorkerBindings } from "./platform.js";
import { runScheduledJob } from "./scheduled.js";

// Worker modules may only export handlers, so the jobs live in scheduled.ts.
export default {
  fetch(request: Request, bindings: WorkerBindings, ctx: ExecutionContext) {
    bindPlatform(bindings);
    return app.fetch(request, bindings, ctx);
  },
  scheduled(
    controller: ScheduledController,
    bindings: WorkerBindings,
    ctx: ExecutionContext,
  ) {
    bindPlatform(bindings);
    ctx.waitUntil(runScheduledJob(controller.cron));
  },
};
