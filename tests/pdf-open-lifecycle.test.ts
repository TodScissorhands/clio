import { expect, test } from "bun:test";
import { deferPdfOpen } from "../src/reader/deferPdfOpen";
import { createSyntheticRecolorPdf } from "./fixtures/synthetic-recolor-doc";

test("effect replay transfers the initial PDF buffer only from the surviving setup", async () => {
  const bytes = createSyntheticRecolorPdf();
  const expected = bytes.slice();
  const received: Uint8Array[] = [];
  const open = () => { received.push(structuredClone(bytes, { transfer: [bytes.buffer] })); };

  const cancelReplay = deferPdfOpen(open);
  cancelReplay();
  const cancelActive = deferPdfOpen(open);
  await Promise.resolve();

  expect(received).toEqual([expected]);
  expect(bytes.buffer.byteLength).toBe(0);
  cancelActive();
});

test("unmount before opening leaves the source buffer available to its owner", async () => {
  const bytes = createSyntheticRecolorPdf();
  const expected = bytes.slice();
  const cancel = deferPdfOpen(() => { structuredClone(bytes, { transfer: [bytes.buffer] }); });
  cancel();
  cancel();
  await Promise.resolve();

  expect(bytes).toEqual(expected);
  expect(structuredClone(bytes, { transfer: [bytes.buffer] })).toEqual(expected);
});

test("replacement before opening transfers only the latest document buffer", async () => {
  const obsolete = createSyntheticRecolorPdf();
  const latest = createSyntheticRecolorPdf();
  const expected = latest.slice();
  const received: Uint8Array[] = [];
  const cancelObsolete = deferPdfOpen(() => {
    received.push(structuredClone(obsolete, { transfer: [obsolete.buffer] }));
  });
  cancelObsolete();
  deferPdfOpen(() => { received.push(structuredClone(latest, { transfer: [latest.buffer] })); });
  await Promise.resolve();

  expect(received).toEqual([expected]);
  expect(latest.buffer.byteLength).toBe(0);
  expect(obsolete).toEqual(expected);
});
