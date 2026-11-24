// Adapt existing consumer scenarios to the Index's explicit modes and compact Back control.
const settleIndex = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
export async function indexFilter() {
  await settleIndex();
  if (document.querySelector(".command-palette") && !document.querySelector(".command-filter")) {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    await settleIndex();
  }
}
export async function indexBack() {
  const back = document.querySelector<HTMLButtonElement>('[aria-label="Return to parent chooser"]');
  if (!back) throw new Error("Index parent control missing");
  back.click(); await settleIndex(); await indexFilter();
}
export async function indexClose() {
  for (let i = 0; i < 8 && document.querySelector(".command-palette"); i++) {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settleIndex();
  }
  if (document.querySelector(".command-palette")) throw new Error("Index failed to dismiss");
}
