export const ZOOM_FACTOR = 1.05;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const SPREAD_GAP = 16;
export const MIN_SPREAD_PAGE_WIDTH = 280;

export type PageSize = { width: number; height: number };
export type ViewMode = "single" | "spread";
export type FitMode = "fit-width" | "fit-page" | "fit-spread";
export type ZoomState =
  | { mode: FitMode }
  | { mode: "manual"; basis: FitMode; factor: number };
export type ViewportSize = { width: number; height: number };

export function getPageGroupIndices(pageCount: number, viewMode: ViewMode): number[][] {
  if (viewMode === "single") {
    return Array.from({ length: pageCount }, (_, index) => [index]);
  }
  if (!pageCount) return [];

  const groups: number[][] = [];
  for (let index = 0; index < pageCount; index += 2) {
    groups.push(index + 1 < pageCount ? [index, index + 1] : [index]);
  }
  return groups;
}

export function getPageGroups(pageSizes: PageSize[], viewMode: ViewMode): PageSize[][] {
  return getPageGroupIndices(pageSizes.length, viewMode)
    .map((group) => group.map((index) => pageSizes[index]));
}

export function getAdjacentPageNumber(
  pageNumber: number,
  direction: number,
  pageCount: number,
  viewMode: ViewMode,
): number {
  const groups = getPageGroupIndices(pageCount, viewMode);
  const currentGroup = groups.findIndex((group) => group.includes(pageNumber - 1));
  if (currentGroup < 0) return pageNumber;
  const nextGroup = Math.max(0, Math.min(groups.length - 1, currentGroup + direction));
  return groups[nextGroup][0] + 1;
}

export function calculateFitScale(
  mode: FitMode,
  pageSizes: PageSize[],
  viewMode: ViewMode,
  availableSize: ViewportSize,
  currentPageNumber = 1,
): number {
  if (!pageSizes.length) return 1;
  const availableWidth = Math.max(1, availableSize.width);
  const availableHeight = Math.max(1, availableSize.height);
  const requestedPage = Number.isFinite(currentPageNumber) ? Math.trunc(currentPageNumber) : 1;
  const pageIndex = Math.max(0, Math.min(pageSizes.length - 1, requestedPage - 1));
  const page = pageSizes[pageIndex];

  if (mode === "fit-page") {
    return Math.min(availableWidth / page.width, availableHeight / page.height);
  }

  const groupIndices = getPageGroupIndices(pageSizes.length, viewMode)
    .find((group) => group.includes(pageIndex)) ?? [pageIndex];
  const group = groupIndices.map((index) => pageSizes[index]);
  const groupWidth = group.reduce((width, member) => width + member.width, 0);
  const gapWidth = group.length > 1 ? SPREAD_GAP : 0;
  const groupHeight = Math.max(...group.map((member) => member.height));
  const widthScale = Math.max(1, availableWidth - gapWidth) / groupWidth;
  return mode === "fit-width" ? widthScale : Math.min(widthScale, availableHeight / groupHeight);
}

export function measureAvailableViewport(viewer: HTMLDivElement): ViewportSize {
  const pageViewer = viewer.querySelector<HTMLElement>(".pdfViewer");
  const style = pageViewer ? getComputedStyle(pageViewer) : null;
  const padding = (value: string | undefined) => Number.parseFloat(value ?? "0") || 0;
  const horizontalPadding = padding(style?.paddingLeft) + padding(style?.paddingRight);
  const verticalPadding = padding(style?.paddingTop) + padding(style?.paddingBottom);
  return {
    width: Math.max(1, viewer.clientWidth - horizontalPadding),
    height: Math.max(1, viewer.clientHeight - verticalPadding),
  };
}


export function getPagedWheelDirection(
  deltaY: number,
  continuousScrolling: boolean,
  modified: boolean,
): -1 | 1 | null {
  if (continuousScrolling || modified || deltaY === 0) return null;
  return deltaY > 0 ? 1 : -1;
}
export function canNavigatePagedWheel(now: number, lastNavigationAt: number): boolean {
  return now - lastNavigationAt >= 150;
}

export function isPageZoomedIn(pageBounds: ViewportSize, viewport: ViewportSize): boolean {
  return pageBounds.width > viewport.width || pageBounds.height > viewport.height;
}

export function getPagePanDelta(
  pageStart: number,
  pageEnd: number,
  viewportStart: number,
  viewportEnd: number,
  direction: -1 | 1,
  step: number,
): number {
  const distanceToBoundary = direction > 0 ? pageEnd - viewportEnd : viewportStart - pageStart;
  if (distanceToBoundary <= 0) return 0;
  return direction * Math.min(distanceToBoundary, step);
}

export type RectBounds = { left: number; top: number; right: number; bottom: number };

export function getCenterPreservingScrollDelta(
  before: RectBounds,
  after: RectBounds,
  center: { x: number; y: number },
): { left: number; top: number } {
  const beforeWidth = before.right - before.left;
  const beforeHeight = before.bottom - before.top;
  const afterWidth = after.right - after.left;
  const afterHeight = after.bottom - after.top;
  if (beforeWidth <= 0 || beforeHeight <= 0 || afterWidth <= 0 || afterHeight <= 0) {
    return { left: 0, top: 0 };
  }
  const normalizedX = (center.x - before.left) / beforeWidth;
  const normalizedY = (center.y - before.top) / beforeHeight;
  return {
    left: after.left + normalizedX * afterWidth - center.x,
    top: after.top + normalizedY * afterHeight - center.y,
  };
}
