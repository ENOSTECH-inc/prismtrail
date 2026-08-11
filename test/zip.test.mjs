import assert from "node:assert/strict";
import test from "node:test";
import { createZipArchive, reportBundleFilenames } from "../lib/zip.mjs";

function centralDirectoryNames(archive) {
  const bytes = Buffer.from(archive);
  const names = [];
  let offset = 0;
  while (offset <= bytes.length - 46) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

test("creates deterministic report bundle filenames", () => {
  assert.deepEqual(reportBundleFilenames("prismtrail-run-demo.pdf"), {
    summary: "prismtrail-run-demo-summary.pdf",
    details: "prismtrail-run-demo-details.pdf",
    archive: "prismtrail-run-demo-reports.zip"
  });
});

test("creates a ZIP containing the summary and detailed PDFs", () => {
  const archive = createZipArchive([
    { name: "report-summary.pdf", bytes: Buffer.from("%PDF-summary") },
    { name: "report-details.pdf", bytes: Buffer.from("%PDF-details") }
  ], { date: new Date("2026-08-09T00:00:00.000Z") });

  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(centralDirectoryNames(archive), ["report-summary.pdf", "report-details.pdf"]);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 2);
});

test("rejects unsafe ZIP entry paths", () => {
  assert.throws(
    () => createZipArchive([{ name: "../report.pdf", bytes: Buffer.from("x") }]),
    /ファイル名が不正/
  );
});
