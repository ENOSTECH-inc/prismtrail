import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FONT_DIR = path.join(ROOT, "assets", "fonts");

/** Static subset OTFs — variable TTF rendered too thin in pdfme. */
const FONT_FILES = {
  NotoSansJP: {
    path: path.join(FONT_DIR, "NotoSansJP-Regular.otf"),
    url:
      process.env.PRISMTRAIL_PDF_FONT_REGULAR_URL ||
      "https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf",
    fallback: true
  },
  "NotoSansJP-Medium": {
    path: path.join(FONT_DIR, "NotoSansJP-Medium.otf"),
    url:
      process.env.PRISMTRAIL_PDF_FONT_MEDIUM_URL ||
      "https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/JP/NotoSansJP-Medium.otf"
  },
  "NotoSansJP-Bold": {
    path: path.join(FONT_DIR, "NotoSansJP-Bold.otf"),
    url:
      process.env.PRISMTRAIL_PDF_FONT_BOLD_URL ||
      "https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf"
  }
};

export const FONT_NAME = "NotoSansJP-Medium";
export const FONT_NAME_REGULAR = "NotoSansJP";
export const FONT_NAME_BOLD = "NotoSansJP-Bold";
export const FONT_PATH = FONT_FILES.NotoSansJP.path;

let fontCache = null;
let ensurePromise = null;

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFont(filePath, url) {
  const tempPath = `${filePath}.download`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`フォントの取得に失敗しました (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(tempPath));
  await rename(tempPath, filePath);
}

export async function ensureNotoSansJpFont({ force = false } = {}) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await mkdir(FONT_DIR, { recursive: true });
    for (const entry of Object.values(FONT_FILES)) {
      if (force || !(await fileExists(entry.path))) {
        try {
          await downloadFont(entry.path, entry.url);
        } catch (error) {
          await unlink(`${entry.path}.download`).catch(() => {});
          throw new Error(`Noto Sans JP フォントを準備できませんでした: ${error.message}`);
        }
      }
    }
    fontCache = null;
    return FONT_PATH;
  })().finally(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

export async function loadPdfFontOptions() {
  if (fontCache) return fontCache;
  await ensureNotoSansJpFont();
  const font = {};
  for (const [name, entry] of Object.entries(FONT_FILES)) {
    font[name] = {
      data: await readFile(entry.path),
      subset: true,
      ...(entry.fallback ? { fallback: true } : {})
    };
  }
  fontCache = font;
  return fontCache;
}
