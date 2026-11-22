// What the command lines share: whether a module runs as the main script, and writing a file whole.
import { realpathSync } from "node:fs";
import { writeFile, rename, rm, stat, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// Whether the module at `url` (its import.meta.url) is the script Node runs, also through a
// symbolic link or a path with spaces or non-ASCII characters. The skill's bundle gives each
// command line a URL of its own that names no file (tools/skill.mjs): never the main script.
export function isMain(url) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false; // standard input, no script at all, or a bundled command line
  }
}

// Writes `data` to a new file of its own next to `path` (never an existing one, never through a
// link), then renames it over `path`: a failed write never leaves a half-written file. The new
// file is private until it takes the permissions of the file it replaces.
export async function writeWhole(path, data) {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const mode = await stat(path).then(
    (s) => s.mode & 0o7777,
    () => null,
  );
  try {
    await writeFile(temporary, data, {
      flag: "wx",
      ...(mode === null ? {} : { mode: 0o600 }),
    });
    if (mode !== null) await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    // Only the file this call created is removed.
    if (error.code !== "EEXIST") await rm(temporary, { force: true });
    throw error;
  }
}
