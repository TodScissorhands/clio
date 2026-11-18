import type { View } from "foliate-js/view.js";

export function foliateView() {
  return document.querySelector<View>('.foliate-publication[aria-busy="false"] > foliate-view');
}

export function epubDocument() {
  const view = foliateView();
  return view?.renderer.getContents().find(({ index }) => index === view.renderer.primaryIndex)?.doc ?? null;
}

export function epubText() {
  return epubDocument()?.body?.textContent ?? "";
}
