import type { FastifyPluginAsync } from "fastify";
import path from "node:path";
import { access, copyFile, mkdir, rm, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { MEDIA_DIR, EXPORT_DIR } from "../config.js";
import {
  getApproval,
  listApprovals,
  removeApproval,
  removeApprovals,
  type ApprovalItem,
} from "../services/approvals.js";

function safePath(base: string, reqPath: string): string | null {
  const rel = path.normalize(reqPath ?? "").replace(/^[/\\]+/, "");
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base))) return null;
  return abs;
}

function replaceTargetFor(sourcePath: string, outputPath: string): string {
  const src = path.parse(sourcePath);
  const out = path.parse(outputPath);
  return path.join(src.dir, `${src.name}${out.ext || ".mkv"}`);
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function moveFile(sourceAbs: string, targetAbs: string): Promise<void> {
  try {
    await rm(targetAbs, { force: true });
    await mkdir(path.dirname(targetAbs), { recursive: true });
    await copyFile(sourceAbs, targetAbs);
    await unlink(sourceAbs);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
}

async function replaceOne(item: ApprovalItem): Promise<{ targetPath: string }> {
  const sourceAbs = safePath(MEDIA_DIR, item.sourcePath);
  const outputAbs = safePath(EXPORT_DIR, item.outputPath);

  if (!sourceAbs || !outputAbs) {
    throw new Error("Invalid source/output path");
  }

  const targetRel = replaceTargetFor(item.sourcePath, item.outputPath);
  const targetAbs = safePath(MEDIA_DIR, targetRel);
  if (!targetAbs) {
    throw new Error("Invalid target path");
  }

  const outputExists = await pathExists(outputAbs);
  if (!outputExists) {
    throw new Error("Transcoded output file not found");
  }

  if (sourceAbs !== targetAbs) {
    await rm(sourceAbs, { force: true }).catch(() => {});
  }

  await moveFile(outputAbs, targetAbs);
  return { targetPath: targetRel };
}

const approvalsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/approvals", async () => {
    const items = listApprovals();
    return {
      total: items.length,
      items,
      servedAt: new Date().toISOString(),
    };
  });

  fastify.post<{ Params: { id: string } }>(
    "/api/approvals/:id/replace",
    async (req, reply) => {
      const item = getApproval(req.params.id);
      if (!item) {
        return reply.code(404).send({ error: "Approval item not found" });
      }

      try {
        const result = await replaceOne(item);
        removeApproval(item.id);
        return {
          replaced: 1,
          sourcePath: item.sourcePath,
          outputPath: item.outputPath,
          targetPath: result.targetPath,
        };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  fastify.post("/api/approvals/replace-all", async () => {
    const items = listApprovals();
    if (!items.length) {
      return {
        replaced: 0,
        failed: 0,
        failures: [],
      };
    }

    let replaced = 0;
    const failures: Array<{ id: string; sourcePath: string; error: string }> =
      [];
    const replacedIds: string[] = [];

    for (const item of items) {
      try {
        await replaceOne(item);
        replaced += 1;
        replacedIds.push(item.id);
      } catch (err) {
        failures.push({
          id: item.id,
          sourcePath: item.sourcePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (replacedIds.length) {
      removeApprovals(replacedIds);
    }

    return {
      replaced,
      failed: failures.length,
      failures,
    };
  });

  fastify.delete<{ Params: { id: string } }>(
    "/api/approvals/:id",
    async (req, reply) => {
      const ok = removeApproval(req.params.id);
      if (!ok) {
        return reply.code(404).send({ error: "Approval item not found" });
      }
      return reply.code(204).send();
    },
  );
};

export default approvalsRoute;
