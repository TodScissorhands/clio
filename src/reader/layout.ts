export const ZOOM_FACTOR = 1.05;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const SPREAD_GAP = 4;
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


export type PagedWheelState = {
  distance: number;
  lastEventAt: number;
  turned: boolean;
};

export function createPagedWheelState(): PagedWheelState {
  return { distance: 0, lastEventAt: Number.NEGATIVE_INFINITY, turned: false };
}

// These define a navigation action, not a mouse/touchpad classification.
const PAGED_WHEEL_DISTANCE = 48;
const PAGED_WHEEL_QUIET_MS = 250;
const WHEEL_LINE_HEIGHT = 16;

export function getPagedWheelAction(
  state: PagedWheelState,
  input: {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    now: number;
    continuousScrolling: boolean;
    modified: boolean;
    blocked: boolean;
  },
  pageBounds: ViewportSize,
  viewport: ViewportSize,
): -1 | 0 | 1 | null {
  if (
    input.continuousScrolling || input.modified || input.blocked ||
    pageBounds.width <= 0 || pageBounds.height <= 0 ||
    pageBounds.width > viewport.width + 0.5 || pageBounds.height > viewport.height + 0.5 ||
    !Number.isFinite(input.deltaX) || !Number.isFinite(input.deltaY) ||
    input.deltaMode < 0 || input.deltaMode > 2 || !Number.isInteger(input.deltaMode)
  ) {
    state.distance = 0;
    state.lastEventAt = Number.NEGATIVE_INFINITY;
    state.turned = false;
    return null;
  }

  if (input.now - state.lastEventAt >= PAGED_WHEEL_QUIET_MS) {
    state.distance = 0;
    state.turned = false;
  }
  // Measure quiet time from the last event, including a continuing momentum tail.
  state.lastEventAt = input.now;
  const xUnit = input.deltaMode === 1 ? WHEEL_LINE_HEIGHT : input.deltaMode === 2 ? viewport.width : 1;
  const yUnit = input.deltaMode === 1 ? WHEEL_LINE_HEIGHT : input.deltaMode === 2 ? viewport.height : 1;
  const deltaX = input.deltaX * xUnit;
  const deltaY = input.deltaY * yUnit;
  if (Math.abs(deltaY) <= Math.abs(deltaX)) {
    state.distance = 0;
    return null;
  }
  if (state.turned) return 0;
  if (Math.sign(deltaY) !== Math.sign(state.distance)) state.distance = 0;
  state.distance += deltaY;
  if (Math.abs(state.distance) < PAGED_WHEEL_DISTANCE) return 0;
  state.turned = true;
  return state.distance > 0 ? 1 : -1;
}

export type WheelZoomState = {
  distance: number;
  lastEventAt: number;
};

export function createWheelZoomState(): WheelZoomState {
  return { distance: 0, lastEventAt: Number.NEGATIVE_INFINITY };
}

const WHEEL_ZOOM_DISTANCE = 48;
const WHEEL_ZOOM_IDLE_MS = 200;

export function getWheelZoomDirection(
  state: WheelZoomState,
  input: { deltaY: number; deltaMode: number; now: number },
  pageHeight: number,
): -1 | 0 | 1 | null {
  if (
    !Number.isFinite(input.deltaY) ||
    input.deltaMode < 0 || input.deltaMode > 2 || !Number.isInteger(input.deltaMode) ||
    (input.deltaMode === 2 && (!Number.isFinite(pageHeight) || pageHeight <= 0))
  ) {
    state.distance = 0;
    state.lastEventAt = Number.NEGATIVE_INFINITY;
    return null;
  }
  if (input.now - state.lastEventAt >= WHEEL_ZOOM_IDLE_MS) state.distance = 0;
  state.lastEventAt = input.now;
  const unit = input.deltaMode === 1 ? WHEEL_LINE_HEIGHT : input.deltaMode === 2 ? pageHeight : 1;
  const delta = input.deltaY * unit;
  if (delta === 0 || Math.sign(delta) !== Math.sign(state.distance)) state.distance = 0;
  // No queued distance debt: a large event can request only one existing zoom step.
  state.distance = Math.max(-WHEEL_ZOOM_DISTANCE, Math.min(WHEEL_ZOOM_DISTANCE, state.distance + delta));
  if (Math.abs(state.distance) < WHEEL_ZOOM_DISTANCE) return 0;
  const direction = state.distance < 0 ? 1 : -1;
  state.distance = 0;
  return direction;
}

export function getNextZoomFactor(factor: number, direction: number): number {
  const multiplier = direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor * multiplier));
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

export function isScaleEffectivelyEqual(
  currentScale: number,
  targetScale: number,
  tolerance = 1e-4,
): boolean {
  if (!Number.isFinite(currentScale) || !Number.isFinite(targetScale) || currentScale <= 0 || targetScale <= 0) {
    return false;
  }
  return Math.abs(currentScale - targetScale) <= tolerance;
}

export function hasViewportSizeChanged(
  prev: ViewportSize,
  next: ViewportSize,
  minDelta = 1,
): boolean {
  return Math.abs(prev.width - next.width) >= minDelta || Math.abs(prev.height - next.height) >= minDelta;
}
