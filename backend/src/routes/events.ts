import type { FastifyPluginAsync } from "fastify";
import { queueEvents } from "../services/jobQueue.js";
import { getAvailableEncoders } from "../services/ffmpeg.js";

const eventsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/events", async (req, reply) => {
    // take over the raw response so Fastify doesn't close it
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("\n");

    const send = (type: string, data: unknown): void => {
      try {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* client gone */
      }
    };

    // send hardware state immediately on connect
    send("status", { availableEncoders: getAvailableEncoders() });

    const onEvent = (e: { type: string; job?: unknown }): void =>
      send(e.type, e.job ?? e);

    queueEvents.on("event", onEvent);

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // wait until client disconnects
    await new Promise<void>((resolve) => {
      req.raw.on("close", resolve);
      req.raw.on("error", resolve);
    });

    clearInterval(heartbeat);
    queueEvents.off("event", onEvent);
    res.end();
  });
};

export default eventsRoute;
