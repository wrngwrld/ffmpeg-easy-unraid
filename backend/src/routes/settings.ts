import type { FastifyPluginAsync } from "fastify";
import { getParallelJobs, setParallelJobs } from "../services/jobQueue.js";
import {
  getParallelJobsLimits,
  readSettings,
  writeSettings,
} from "../services/settings.js";

interface UpdateSettingsBody {
  parallelJobs?: number;
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
      const nextParallelJobs = req.body?.parallelJobs;
      if (
        typeof nextParallelJobs !== "number" ||
        !Number.isInteger(nextParallelJobs)
      ) {
        return reply
          .code(400)
          .send({ error: "parallelJobs must be an integer" });
      }

      const limits = getParallelJobsLimits();
      if (nextParallelJobs < limits.min || nextParallelJobs > limits.max) {
        return reply
          .code(400)
          .send({
            error: `parallelJobs must be between ${limits.min} and ${limits.max}`,
          });
      }

      const saved = writeSettings({ parallelJobs: nextParallelJobs });
      const active = setParallelJobs(saved.parallelJobs);

      return {
        settings: {
          parallelJobs: active,
        },
        limits,
      };
    },
  );
};

export default settingsRoute;
