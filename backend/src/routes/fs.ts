import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR, MEDIA_EXTENSIONS } from "../config.js";

interface FsEntry {
  name: string;
  type: "file" | "directory";
  sizeBytes?: number;
  modifiedAt?: string;
  ext?: string;
}

// reject paths that escape the media root
function safePath(reqPath: string): string | null {
  const rel = path.normalize(reqPath ?? "").replace(/^[/\\]+/, "");
  const abs = path.resolve(MEDIA_DIR, rel);
  if (!abs.startsWith(path.resolve(MEDIA_DIR))) return null;
  return abs;
}

const fsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { path?: string } }>(
    "/api/fs",
    async (req, reply) => {
      const abs = safePath(req.query.path ?? "/");
      if (!abs) return reply.code(400).send({ error: "Invalid path" });

      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return reply.code(404).send({ error: "Path not found" });
      }

      const entries: FsEntry[] = [];

      for (const d of dirents) {
        if (d.name.startsWith(".")) continue;

        if (d.isDirectory()) {
          entries.push({ name: d.name, type: "directory" });
        } else if (d.isFile()) {
          const ext = path.extname(d.name).toLowerCase();
          if (!MEDIA_EXTENSIONS.has(ext)) continue;

          let sizeBytes: number | undefined;
          let modifiedAt: string | undefined;
          try {
            const st = fs.statSync(path.join(abs, d.name));
            sizeBytes = st.size;
            modifiedAt = st.mtime.toISOString();
          } catch {
            /* non-fatal */
          }

          entries.push({
            name: d.name,
            type: "file",
            ext,
            sizeBytes,
            modifiedAt,
          });
        }
      }

      // directories first, then files; both alpha-sorted
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      const relPath = "/" + path.relative(MEDIA_DIR, abs).replace(/\\/g, "/");

      return { path: relPath === "/." ? "/" : relPath, entries };
    },
  );
};

export default fsRoute;
