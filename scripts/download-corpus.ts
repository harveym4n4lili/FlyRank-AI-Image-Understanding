// Downloads the hand-picked image corpus listed in data/manifest.json into data/images/,
// resized to at most 800px JPEG. Idempotent: files that already exist are skipped.
//
//   npm run corpus:download            # download missing images
//   npm run corpus:download -- --force # re-download everything

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { SUBJECT_LABELS } from "../src/config/taxonomy.js";

const MANIFEST_PATH = "data/manifest.json";
const IMAGES_DIR = "data/images";
const MAX_EDGE = 800;
const MIN_IMAGES = 40;
const MIN_CATEGORIES = 4;

// Every entry is a Pexels photo page: https://www.pexels.com/photo/<slug>-<numeric id>/
// The direct JPEG URL and the file name are derived from it.
const PEXELS_PAGE = /^https:\/\/www\.pexels\.com\/photo\/(?:[a-z0-9-]+-)?(\d+)\/?$/;

const Entry = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and hyphens only"),
    source_url: z.string().regex(PEXELS_PAGE, "must be a Pexels photo page URL"),
    expected_label: z.enum(SUBJECT_LABELS),
    notes: z.string().optional(),
  })
  .strict()
  .transform((entry) => {
    const pexelsId = entry.source_url.match(PEXELS_PAGE)![1];
    return {
      ...entry,
      file: `${entry.id}.jpg`,
      download_url: `https://images.pexels.com/photos/${pexelsId}/pexels-photo-${pexelsId}.jpeg?w=1600`,
    };
  });

const Manifest = z.array(Entry);

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) fail(`${MANIFEST_PATH} not found`);
  const parsed = Manifest.safeParse(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`  entry ${issue.path.join(".")}: ${issue.message}`);
    fail("manifest is invalid");
  }

  const entries = parsed.data;
  for (const key of ["id", "source_url"] as const) {
    const dupes = entries.map((e) => e[key]).filter((v, i, all) => all.indexOf(v) !== i);
    if (dupes.length) fail(`duplicate ${key}: ${[...new Set(dupes)].join(", ")}`);
  }
  return entries;
}

async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const force = process.argv.includes("--force");
  const entries = loadManifest();
  mkdirSync(IMAGES_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const entry of entries) {
    const target = join(IMAGES_DIR, entry.file);
    if (!force && existsSync(target)) {
      skipped++;
      continue;
    }
    try {
      const original = await download(entry.download_url);
      const resized = await sharp(original)
        .rotate()
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      writeFileSync(target, resized);
      downloaded++;
      console.log(`✔ ${entry.file} (${Math.round(resized.length / 1024)} KB)`);
    } catch (err) {
      failed.push(entry.id);
      console.error(`✖ ${entry.id}: ${(err as Error).message}`);
    }
  }

  const totalBytes = entries
    .map((e) => join(IMAGES_DIR, e.file))
    .filter(existsSync)
    .reduce((sum, path) => sum + statSync(path).size, 0);

  const perLabel = new Map<string, number>();
  for (const e of entries) perLabel.set(e.expected_label, (perLabel.get(e.expected_label) ?? 0) + 1);

  console.log(`\nDownloaded ${downloaded}, skipped ${skipped}, failed ${failed.length}`);
  console.log(`Corpus: ${entries.length} images, ${(totalBytes / 1024 / 1024).toFixed(2)} MB on disk`);
  console.log(`Per label: ${[...perLabel].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (entries.length < MIN_IMAGES) console.warn(`⚠ brief requires at least ${MIN_IMAGES} images`);
  if (perLabel.size < MIN_CATEGORIES) console.warn(`⚠ brief requires at least ${MIN_CATEGORIES} categories`);
  if (failed.length) process.exit(1);
}

await main();
