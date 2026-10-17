import { HttpSource } from "./sources/http";
import { reconstruct } from "./reconstruction";

const params = new URLSearchParams(location.search);
const url = params.get("source");
if (!url) {
  throw new Error("missing source parameter");
}

const output = document.createElement("pre");
document.body.appendChild(output);

const source = new HttpSource(url);
source.start((record) => {
  output.textContent = reconstruct(record);
}).catch((error: unknown) => {
  output.textContent = String(error);
});
