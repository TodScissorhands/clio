/** Let effect cleanup cancel replayed or replaced sources before PDF.js takes their buffers. */
export function deferPdfOpen(open: () => void): () => void {
  let canceled = false;
  queueMicrotask(() => {
    if (!canceled) open();
  });
  return () => { canceled = true; };
}
