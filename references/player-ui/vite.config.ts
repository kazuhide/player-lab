import { defineConfig } from "vite";
import { resolve } from "node:path";
import { privateQueryPlugin } from "./server/private-query.ts";

export default defineConfig(({ command }) => {
  const privateFile = process.env.PLAYER_UI_PRIVATE_QUERY_FILE;
  const privateMedia = process.env.PLAYER_UI_PRIVATE_MEDIA_DIRECTORY;
  if (command === "build" && (privateFile || privateMedia)) {
    throw new Error("Unset PLAYER_UI_PRIVATE_QUERY_FILE and PLAYER_UI_PRIVATE_MEDIA_DIRECTORY before a production build");
  }
  return {
    base: "./",
    server: { host: "127.0.0.1", port: 5199, strictPort: true, cors: privateFile || privateMedia ? false : undefined },
    preview: { host: "127.0.0.1", port: 5199, strictPort: true },
    plugins: [privateQueryPlugin(privateFile, resolve(import.meta.dirname, "../.."), privateMedia)],
    build: { target: "es2022" },
  };
});
