import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FoliateReader } from "./FoliateReader";
import "../index.css";

const sessionId = new URLSearchParams(location.search).get("epubSession");
createRoot(document.getElementById("root")!).render(<StrictMode>
  {sessionId ? <FoliateReader sessionId={sessionId} /> : <p role="alert">Missing EPUB reader session.</p>}
</StrictMode>);
