import { useLayoutEffect, useRef } from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";

type Point = { x: number; y: number };

/** Coordinates belong to this overlay mount, never to the document or preferences. */
export function usePaletteDrag(panelRef: RefObject<HTMLDivElement | null>, onPromptClick?: (target: HTMLElement) => void) {
  const suppressClick = useRef(false);
  const clickTarget = useRef<HTMLElement | null>(null);
  const position = useRef<Point | null>(null);
  const pointer = useRef<{ id: number; handle: HTMLElement; start: Point; origin: Point; moved: boolean } | null>(null);
  const place = (point: Point) => {
    const panel = panelRef.current;
    const viewport = panel?.parentElement;
    if (!panel || !viewport) return;
    const bounds = panel.getBoundingClientRect();
    const available = viewport.getBoundingClientRect();
    const x = Math.max(4, Math.min(point.x, available.width - bounds.width - 4));
    const y = Math.max(4, Math.min(point.y, available.height - bounds.height - 4));
    position.current = { x, y };
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.transform = "none";
  };
  const release = () => {
    const drag = pointer.current;
    pointer.current = null;
    if (drag?.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
  };
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel?.parentElement) return;
    const clamp = () => { if (position.current) place(position.current); };
    const observer = new ResizeObserver(clamp);
    observer.observe(panel);
    observer.observe(panel.parentElement);
    window.visualViewport?.addEventListener("resize", clamp);
    window.visualViewport?.addEventListener("scroll", clamp);
    return () => {
      release();
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", clamp);
      window.visualViewport?.removeEventListener("scroll", clamp);
    };
  }, [panelRef]);

  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      // Blank header space and prompt labels are handles; editable input and Back retain their defaults.
      suppressClick.current = false;
      const target = event.target as HTMLElement;
      clickTarget.current = target.closest<HTMLElement>("[data-prompt-activation]");
      if (event.target !== event.currentTarget && !target.closest("[data-prompt-activation]")) return;
      if (!event.isPrimary || event.button !== 0) return;
      const panel = panelRef.current;
      if (!panel?.parentElement) return;
      const rect = panel.getBoundingClientRect();
      const viewport = panel.parentElement.getBoundingClientRect();
      event.preventDefault();
      pointer.current = { id: event.pointerId, handle: event.currentTarget,
        start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left - viewport.left, y: rect.top - viewport.top }, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const drag = pointer.current;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.start.x;
      const dy = event.clientY - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true; suppressClick.current = true;
      place({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (event.detail === 0) return;
      const target = clickTarget.current; clickTarget.current = null;
      if (suppressClick.current || target) {
        event.preventDefault(); event.stopPropagation();
        if (!suppressClick.current && target) onPromptClick?.(target);
        suppressClick.current = false;
      }
    },
    onPointerUp: release,
    onPointerCancel() { suppressClick.current = true; clickTarget.current = null; release(); },
    onLostPointerCapture: release,
  };
}
