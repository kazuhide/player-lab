import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

/** Local real-media fixture: no credentials, arbitrary upstream URLs, or request logging. */
export async function startConfigurationServer(directory, port = 5274) {
  const root = await realpath(directory);
  let remainingFailures = 0;
  let retryManifestRequests = 0;
  let retryFailures = 0;
  let subtitleRequests = 0;
  const timestamp = seconds => `00:00:${String(seconds).padStart(2, "0")}`;
  // Distinct cues and gaps provide real future cue transitions after a viewer enables the track.
  const captions = Buffer.from("WEBVTT\n\n" + Array.from({ length: 30 }, (_, index) =>
    `${timestamp(index * 2)}.250 --> ${timestamp(index * 2 + 1)}.750\nPlayer Lab external subtitle ${index + 1}\n\n`).join(""));
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      let pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (pathname === "/captions.vtt") {
        subtitleRequests++;
        send(200, "text/vtt", captions);
        return;
      }
      if (pathname.startsWith("/retry/")) {
        pathname = pathname.slice("/retry".length);
        if (pathname === "/vod-multiaudio/master.m3u8") {
          retryManifestRequests++;
          if (remainingFailures > 0) {
            remainingFailures--;
            retryFailures++;
            send(503, "text/plain", Buffer.from("Temporary fixture failure"));
            return;
          }
        }
      }
      if (!/^\/(vod-baseline|vod-multiaudio)\//.test(pathname)) {
        response.writeHead(404).end();
        return;
      }
      const file = await realpath(resolve(root, `.${pathname}`));
      if (!file.startsWith(`${root}${sep}`) || !(await stat(file)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const extension = extname(file);
      const contentType = extension === ".m3u8" ? "application/vnd.apple.mpegurl"
        : extension === ".mpd" ? "application/dash+xml" : "video/mp4";
      send(200, contentType, await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
    function send(status, contentType, body) {
      response.writeHead(status, {
        "Content-Type": contentType, "Content-Length": body.length,
        "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    }
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  return {
    origin: `http://localhost:${server.address().port}`,
    reset(failures = 2) {
      if (!Number.isInteger(failures) || failures < 0 || failures > 3) {
        throw new RangeError("Fixture failures must be an integer from 0 to 3.");
      }
      remainingFailures = failures;
      retryManifestRequests = retryFailures = subtitleRequests = 0;
    },
    counts() { return { remainingFailures, retryManifestRequests, retryFailures, subtitleRequests }; },
    close() {
      server.closeAllConnections();
      return new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    },
  };
}
