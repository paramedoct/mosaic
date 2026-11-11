import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

const notices = ["sql.js"].map(name =>
  readFileSync(new URL(`./3rdparty/${name}/copyright`, import.meta.url), "utf8")
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
