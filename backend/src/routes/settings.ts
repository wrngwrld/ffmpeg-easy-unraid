import type { FastifyPluginAsync } from "fastify";
import { getParallelJobs, setParallelJobs } from "../services/jobQueue.js";
import {
  getParallelJobsLimits,
  readSettings,
  type TranscodeDefaults,
  writeSettings,
} from "../services/settings.js";

interface UpdateSettingsBody {
  parallelJobs?: number;
  defaultTranscode?: Partial<TranscodeDefaults>;
}

const settingsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/settings", async () => {
    const limits = getParallelJobsLimits();
    const stored = readSettings();
    return {
      settings: {
        parallelJobs: getParallelJobs(),
      },
      defaults: stored,
      limits,
    };
  });

  fastify.put<{ Body: UpdateSettingsBody }>(
    "/api/settings",
    async (req, reply) => {
      const body = req.body ?? {};
      const limits = getParallelJobsLimits();
      const current = readSettings();

      let nextParallelJobs = current.parallelJobs;
      const hasParallelJobs = Object.prototype.hasOwnProperty.call(
        body,
        "parallelJobs",
      );

      // Allow partial updates that omit/null this field (e.g. saving default transcode options only).
      if (hasParallelJobs && body.parallelJobs != null) {
        if (
          typeof body.parallelJobs !== "number" ||
          !Number.isInteger(body.parallelJobs)
        ) {
          return reply
            .code(400)
            .send({ error: "parallelJobs must be an integer" });
        }
        if (body.parallelJobs < limits.min || body.parallelJobs > limits.max) {
          return reply.code(400).send({
            error: `parallelJobs must be between ${limits.min} and ${limits.max}`,
          });
        }
        nextParallelJobs = body.parallelJobs;
      }

      if (body.defaultTranscode?.qp !== undefined) {
        const qp = body.defaultTranscode.qp;
        if (
          typeof qp !== "number" ||
          !Number.isInteger(qp) ||
          qp < 0 ||
          qp > 51
        ) {
          return reply
            .code(400)
            .send({ error: "defaultTranscode.qp must be an integer 0-51" });
        }
      }

      const saved = writeSettings({
        parallelJobs: nextParallelJobs,
        defaultTranscode: {
          ...current.defaultTranscode,
          ...(body.defaultTranscode ?? {}),
        },
      });
      const active = setParallelJobs(saved.parallelJobs);

      return {
        settings: {
          parallelJobs: active,
        },
        defaults: saved,
        limits,
      };
    },
  );
};

export default settingsRoute;
