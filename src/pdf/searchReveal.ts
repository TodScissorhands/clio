type Bounds = { left: number; top: number; right: number; bottom: number };
type ScrollArea = { scrollTop: number; scrollLeft: number; scrollHeight: number; scrollWidth: number; clientHeight: number; clientWidth: number };

/** Client-space match bounds, including every line; leave room for the outline. */
export function getSearchRevealScroll(match: Bounds, viewport: Bounds, area: ScrollArea): { top: number; left: number } {
  const margin = 4;
  const height = viewport.bottom - viewport.top;
  const width = viewport.right - viewport.left;
  const matchHeight = match.bottom - match.top;
  const targetY = viewport.top + Math.max(margin, Math.min(height * .4, height - matchHeight - margin));
  let dx = 0;
  if (match.right - match.left > width - margin * 2 || match.left < viewport.left + margin) {
    dx = match.left - viewport.left - margin;
  } else if (match.right > viewport.right - margin) {
    dx = match.right - viewport.right + margin;
  }
  return {
    top: Math.max(0, Math.min(area.scrollHeight - area.clientHeight, area.scrollTop + match.top - targetY)),
    left: Math.max(0, Math.min(area.scrollWidth - area.clientWidth, area.scrollLeft + dx)),
  };
}
