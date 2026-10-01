import { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import { ServiceUnavailableException } from "@nestjs/common";
import { ByteRange, StoredReference, StorageService } from "./storage.service";

// Multiple/malformed ranges are ignored as permitted by HTTP; a well-formed but
// unsatisfiable single range gets 416. Only single ranges are needed by players.
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | "unsatisfiable" | undefined {
  if (!header) return;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return;
  if (size === 0) return "unsatisfiable";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

export async function sendFile(
  req: Request,
  res: Response,
  storage: StorageService,
  file: StoredReference & { name: string; type: string },
  disposition: "inline" | "attachment" = "inline",
) {
  const size = await storage.size(file);
  const range = parseRange(
    req.method === "HEAD" || req.headers["if-range"]
      ? undefined
      : req.headers.range,
    size,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Accept-Ranges", "bytes");
  if (range === "unsatisfiable") {
    res.setHeader("Content-Range", `bytes */${size}`);
    res.status(416).end();
    return;
  }
  const stream =
    req.method === "HEAD" ? undefined : await storage.open(file, range);
  res.setHeader("Content-Type", file.type);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  );
  res.setHeader("Content-Length", range ? range.end - range.start + 1 : size);
  if (range)
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  res.status(range ? 206 : 200);
  if (!stream) {
    res.end();
    return;
  }
  try {
    await pipeline(stream, res);
  } catch {
    stream.destroy();
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    throw new ServiceUnavailableException("文件读取失败，请重试");
  }
}
