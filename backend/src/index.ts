import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { mkdir } from "node:fs/promises";
import { PORT, CONFIG_DIR, STATIC_ROOT } from "./config.js";
import { probeHardware } from "./services/ffmpeg.js";
import fsRoute from "./routes/fs.js";
import transcodeRoute from "./routes/transcode.js";
import streamRoute from "./routes/stream.js";
import historyRoute from "./routes/history.js";
import eventsRoute from "./routes/events.js";
import settingsRoute from "./routes/settings.js";

async function main(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await probeHardware();

  const app = Fastify({
    logger: true,
  });

  // parse JSON bodies for POST routes
  await app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // API routes must be registered before the static file catch-all
  await app.register(eventsRoute);
  await app.register(fsRoute);
  await app.register(transcodeRoute);
  await app.register(settingsRoute);
  await app.register(streamRoute);
  await app.register(historyRoute);

  // SPA static files
  await app.register(staticPlugin, { root: STATIC_ROOT, prefix: "/" });

  // SPA fallback — unknown non-API paths get index.html
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
