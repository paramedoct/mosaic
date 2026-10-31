import { icon } from "../../icons";
import { parseFrames } from "./time";
import type { Frame } from "./time";

export function createPanel(title: string, alt: string, timeZone: "UTC" | "KST", imageKind?: "dust" | "chart") {
  const element = document.createElement("section");
  element.className = "weather-panel";
  element.setAttribute("aria-label", title);
  const image = document.createElement("img");
  image.className = "weather-image";
  image.alt = alt;
  const empty = document.createElement("div");
  empty.className = "weather-empty";
  empty.setAttribute("aria-label", "No imagery loaded");
  empty.append(icon("satellite"));
  const stage = document.createElement("div");
  stage.className = "weather-stage";
  if (imageKind === "dust") stage.classList.add("weather-dust-stage");
  stage.append(empty, image);
  let timestampImage: HTMLImageElement | undefined;
  if (imageKind === "chart") {
    const canvas = document.createElement("div");
    canvas.className = "weather-chart-canvas";
    const timestamp = document.createElement("div");
    timestamp.className = "weather-chart-timestamp";
    timestamp.setAttribute("aria-hidden", "true");
    timestampImage = document.createElement("img");
    timestampImage.alt = "";
    timestamp.append(timestampImage);
    canvas.append(image, timestamp);
    stage.append(canvas);
  }
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.className = "weather-panel-status";
  status.textContent = "No imagery loaded";
  element.append(stage, status);
  let frames: Frame[] = [];
  let requestId = 0;
  let disposed = false;
  let aspectRatio: number | undefined;
  let sourceImageWidth: number | undefined;

  function showEmpty(message: string): void {
    image.removeAttribute("src");
    empty.hidden = false;
    status.textContent = message;
  }

  return {
    element,
    get aspectRatio(): number | undefined { return aspectRatio; },
    get imageWidth(): number | undefined { return sourceImageWidth; },
    get hasFrames(): boolean { return frames.length > 0; },
    async prepare(): Promise<() => void> {
      const request = ++requestId;
      function commitEmpty(message: string): () => void {
        return () => {
          if (disposed || request !== requestId) return;
          showEmpty(message);
        };
      }
      const candidates = frames.filter(frame => frame.time <= Date.now()).reverse();
      if (candidates.length === 0) {
        return commitEmpty("No imagery available");
      }
      for (const selected of candidates) {
        const frame = new Image();
        frame.src = selected.url;
        try {
          await frame.decode();
        } catch {
          if (disposed || request !== requestId) return () => {};
          continue;
        }
        if (disposed || request !== requestId) return () => {};
        // AirKorea's 820-square canvas includes margins around the 674-by-795 chart.
        const crop = imageKind === "dust" && frame.naturalWidth === 820 && frame.naturalHeight === 820;
        const chartMask = imageKind === "chart" && frame.naturalWidth === 1073 && frame.naturalHeight === 802;
        // Keep a four-pixel side margin and the relocated timestamp; omit the repeated footer.
        const width = crop ? 674 : chartMask ? 1034 : frame.naturalWidth;
        const height = crop ? 795 : chartMask ? 741 : frame.naturalHeight;
        aspectRatio = width / height;
        sourceImageWidth = frame.naturalWidth;
        return () => {
          if (disposed || request !== requestId) return;
          stage.style.aspectRatio = `${width} / ${height}`;
          stage.classList.toggle("weather-dust-cropped", crop);
          stage.classList.toggle("weather-chart-masked", chartMask);
          image.width = frame.naturalWidth;
          image.height = frame.naturalHeight;
          image.src = frame.src;
          if (timestampImage && chartMask) timestampImage.src = frame.src;
          empty.hidden = true;
          status.textContent = "";
        };
      }
      return commitEmpty("Load failed");
    },
    async refresh(getFrames: () => Promise<string[]>): Promise<boolean> {
      ++requestId;
      frames = [];
      status.textContent = "";
      try {
        const urls = await getFrames();
        if (disposed) return false;
        frames = parseFrames(urls, timeZone);
        if (frames.length === 0) showEmpty("No dated imagery available");
        else status.textContent = "";
        return frames.length > 0;
      } catch {
        if (!disposed) showEmpty("Load failed");
        return false;
      }
    },
    dispose(): void { disposed = true; ++requestId; },
  };
}

