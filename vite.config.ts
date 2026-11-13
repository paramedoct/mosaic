import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

const notices = ["./3rdparty/sql.js/copyright", "./node_modules/fflate/LICENSE"].map(path =>
  readFileSync(new URL(path, import.meta.url), "utf8")
).join("\n\n");

export default defineConfig({
  plugins: [
    viteSingleFile(),
    {
      name: "third-party-notices",
      transformIndexHtml: {
        order: "post",
        handler: html => html.replace("</head>", `<!--\n${notices}\n-->\n</head>`),
      },
    },
  ],
});
