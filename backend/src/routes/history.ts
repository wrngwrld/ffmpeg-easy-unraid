import type { FastifyPluginAsync } from "fastify";
import { readStats } from "../services/stats.js";

const historyRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/history",
    async (req) => {
      const limit = Math.min(
        1000,
        Math.max(1, parseInt(req.query.limit ?? "200", 10) || 200),
      );
      const offset = Math.max(0, parseInt(req.query.offset ?? "0", 10) || 0);

      const stats = readStats();
      return {
        total: stats.recentFiles.length,
        offset,
        limit,
        items: stats.recentFiles.slice(offset, offset + limit),
        totals: stats.totals,
        updatedAt: stats.updatedAt,
        servedAt: new Date().toISOString(),
      };
    },
  );
};

export default historyRoute;
