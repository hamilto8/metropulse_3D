#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const [platform, buildKind, artifactRoot, outputPath, hostValidation] = process.argv.slice(2);
if (!platform || !buildKind || !artifactRoot || !outputPath || !hostValidation) {
  console.error("Usage: release-manifest.mjs <platform> <build-kind> <artifact-root> <output> <host-validation>");
  process.exit(64);
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
const absoluteArtifactRoot = resolve(artifactRoot);
const absoluteOutputPath = resolve(outputPath);

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: "utf8" }).trim();
}

async function digestFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function collect(path, results = []) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    results.push({
      path: relative(absoluteArtifactRoot, path),
      type: "symlink",
      target: await readlink(path)
    });
    return results;
  }
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) {
      await collect(resolve(path, entry), results);
    }
    return results;
  }
  if (info.isFile()) {
    results.push({
      path: relative(absoluteArtifactRoot, path),
      type: "file",
      bytes: info.size,
      sha256: await digestFile(path)
    });
  }
  return results;
}

const files = await collect(absoluteArtifactRoot);
const sourceRevision = command("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]);
const dirty = command("git", ["-C", repositoryRoot, "status", "--porcelain"]) !== "";
const licensePath = resolve(repositoryRoot, "LICENSE");
const manifest = {
  formatVersion: 1,
  product: "MetroPulse 3D",
  platform,
  buildKind,
  artifactRoot: basename(absoluteArtifactRoot),
  sourceRevision,
  sourceTreeDirty: dirty,
  godotVersion: process.env.METROPULSE_GODOT_VERSION ?? "unknown",
  dotnetVersion: command("dotnet", ["--version"]),
  templateVersion: process.env.METROPULSE_TEMPLATE_VERSION ?? "unknown",
  hostValidation,
  signing: process.env.METROPULSE_SIGNING_STATUS ?? "unsigned-or-ad-hoc",
  license: {
    path: "LICENSE",
    sha256: await digestFile(licensePath)
  },
  files
};

await writeFile(absoluteOutputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${absoluteOutputPath} with ${files.length} artifact entries.`);
