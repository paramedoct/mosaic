import { createPanel } from "./panel";

export function createWeatherLayout() {
  const chart = createPanel("Surface chart", "KMA surface weather chart (UTC, every 3 hours)", "UTC", "chart");
  const koreaSatellite = createPanel("Korea satellite", "KMA Korea satellite imagery", "UTC");
  koreaSatellite.element.classList.add("weather-satellite-panel");
  const radar = createPanel("Korea radar", "KMA radar imagery", "KST");
  radar.element.classList.add("weather-radar-panel");
  const pm10 = createPanel("PM10", "AirKorea PM10 forecast animation", "KST", "dust");
  const pm25 = createPanel("PM2.5", "AirKorea PM2.5 forecast animation", "KST", "dust");
  const dustRow = document.createElement("div");
  dustRow.className = "weather-dust-row";
  dustRow.append(pm10.element, pm25.element);
  const weatherColumn = document.createElement("div");
  weatherColumn.className = "weather-column";
  weatherColumn.append(chart.element, dustRow);
  const observationColumn = document.createElement("div");
  observationColumn.className = "weather-column weather-observation-column";
  observationColumn.append(koreaSatellite.element, radar.element);
  const panels = document.createElement("div");
  panels.className = "weather-panels";
  panels.append(weatherColumn, observationColumn);
  function alignImageHeights(): void {
    const radarRatio = radar.aspectRatio ?? 1;
    const satelliteRatio = koreaSatellite.aspectRatio ?? 1;
    const pm10Ratio = pm10.aspectRatio ?? 674 / 795;
    const pm25Ratio = pm25.aspectRatio ?? 674 / 795;
    dustRow.style.setProperty("--weather-dust-columns",
      `minmax(0, ${pm10Ratio}fr) minmax(0, ${pm25Ratio}fr)`);
    const chartRatio = chart.aspectRatio ?? 1034 / 741;
    const weatherRatio = 1 / (1 / chartRatio + 1 / (pm10Ratio + pm25Ratio));
    // Express margins in source-image pixels so they scale with the radar image.
    const sourceWidth = radar.imageWidth ?? 900;
    const sideRatio = 4 / sourceWidth;
    const bottomRatio = 6 / sourceWidth;
    const observationRatio = 1 / ((1 + sideRatio) / satelliteRatio + 1 / radarRatio + bottomRatio);
    const totalRatio = weatherRatio + observationRatio * (1 + 2 * sideRatio);
    const availableHeight = Math.max(0, window.innerHeight - panels.getBoundingClientRect().top - 8);
    const maxWidth = availableHeight * totalRatio;
    const availableWidth = panels.parentElement?.clientWidth ?? panels.clientWidth;
    const radarWidth = Math.min(availableWidth, maxWidth) * observationRatio / totalRatio;
    panels.style.setProperty("--weather-side-margin", `${radarWidth * sideRatio}px`);
    panels.style.setProperty("--weather-bottom-margin", `${radarWidth * bottomRatio}px`);
    panels.style.setProperty("--weather-grid-columns",
      `minmax(0, ${weatherRatio}fr) minmax(0, ${observationRatio}fr)`);
    panels.style.maxWidth = `${maxWidth}px`;
  }
  const allPanels = [chart, koreaSatellite, radar, pm10, pm25];
  return { panels, chart, koreaSatellite, radar, pm10, pm25, allPanels, alignImageHeights };
}
