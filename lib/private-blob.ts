import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import {
  del as vercelDel,
  get as vercelGet,
  put as vercelPut,
} from "@vercel/blob";

function localRoot() {
  const configured = process.env.TEST_BLOB_DIR?.trim();
  if (!configured) return null;
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  )
    throw new Error("TEST_BLOB_DIR_REQUIRES_TEST_DATABASE_URL");
  return path.resolve(configured);
}

function localPath(root: string, pathname: string) {
  const normalized = pathname.replaceAll("\\", "/").replace(/^\/+/, "");
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`))
    throw new Error("INVALID_BLOB_PATH");
  return target;
}

export async function put(
  pathname: string,
  body: Parameters<typeof vercelPut>[1],
  options: Parameters<typeof vercelPut>[2],
) {
  const root = localRoot();
  if (!root) return vercelPut(pathname, body, options);
  const bytes = Buffer.isBuffer(body)
    ? body
    : body instanceof Uint8Array
      ? Buffer.from(body)
      : body instanceof Blob
        ? Buffer.from(await body.arrayBuffer())
        : Buffer.from(await new Response(body as BodyInit).arrayBuffer());
  if (options.maximumSizeInBytes && bytes.length > options.maximumSizeInBytes)
    throw new Error("BLOB_TOO_LARGE");
  const target = localPath(root, pathname);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: options.allowOverwrite === false ? "wx" : "w" });
  return {
    url: `https://local-test-blob.invalid/${encodeURI(pathname)}`,
    downloadUrl: `https://local-test-blob.invalid/${encodeURI(pathname)}?download=1`,
    pathname,
    contentType: options.contentType ?? "application/octet-stream",
    contentDisposition: "inline",
  } as Awaited<ReturnType<typeof vercelPut>>;
}

export async function get(
  pathname: string,
  options: Parameters<typeof vercelGet>[1],
) {
  const root = localRoot();
  if (!root) return vercelGet(pathname, options);
  try {
    const bytes = await readFile(/* turbopackIgnore: true */ localPath(root, pathname));
    return {
      statusCode: 200,
      stream: new Blob([bytes]).stream(),
    } as Awaited<ReturnType<typeof vercelGet>>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function del(pathnames: string | string[]) {
  const root = localRoot();
  if (!root) return vercelDel(pathnames);
  for (const pathname of Array.isArray(pathnames) ? pathnames : [pathnames])
    await rm(localPath(root, pathname), { force: true });
}
