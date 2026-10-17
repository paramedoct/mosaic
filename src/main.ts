import { HttpTransport } from "./transports/http";

const params = new URLSearchParams(location.search);
const url = params.get("source");
if (!url) {
  throw new Error("missing source parameter");
}

const http = new HttpTransport();
http.get(url)
  .then(async (response) => {
    const text = await response.text();
    const output = document.createElement("pre");
    output.textContent = text;
    document.body.appendChild(output);
  })
  .catch((error: unknown) => {
    console.error(error);
  });
