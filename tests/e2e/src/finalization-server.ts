import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

/** Serve real media bytes while changing only the manifest's end-of-event signal. */
export async function startFinalizationServer(directory: string, port: number) {
  const root = await realpath(directory);
  const mpd = await readFile(resolve(root, "manifest.mpd"), "utf8");
  if (!mpd.includes('type="static"') || !mpd.includes('mediaPresentationDuration="PT1M0.0S"')) {
    throw new Error("Finalization tests require the generated 60-second local fixture.");
  }
  let ended = false;
  let liveManifests = 0;
  let finalManifests = 0;
  let mediaRequests = 0;
  let startTime = new Date(Date.now() - 60_000).toISOString();

  function playlist(text: string): string {
    if (text.includes("#EXT-X-STREAM-INF")) return text;
    const lines = text.split("\n").filter((line) =>
      !line.startsWith("#EXT-X-ENDLIST") &&
      !line.startsWith("#EXT-X-PLAYLIST-TYPE") &&
      !line.startsWith("#EXT-X-PROGRAM-DATE-TIME"));
    const firstSegment = lines.findIndex((line) => line.startsWith("#EXTINF"));
    lines.splice(firstSegment, 0, `#EXT-X-PROGRAM-DATE-TIME:${startTime}`);
    if (ended) lines.push("#EXT-X-ENDLIST");
    return lines.join("\n");
  }

  function manifest(text: string): string {
    if (ended) return text.replace('<Period id="0"', '<Period duration="PT60S" id="0"');
    return text.replace('type="static"', `type="dynamic" availabilityStartTime="${startTime}" minimumUpdatePeriod="PT1S" timeShiftBufferDepth="PT60S" suggestedPresentationDelay="PT6S"`)
      .replace(/\s+mediaPresentationDuration="[^"]+"/, "");
  }

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = await realpath(resolve(root, `.${pathname}`));
      if (!file.startsWith(`${root}${sep}`) || !(await stat(file)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const extension = extname(file);
      const contentType = extension === ".m3u8" ? "application/vnd.apple.mpegurl"
        : extension === ".mpd" ? "application/dash+xml" : "video/mp4";
      let body = await readFile(file);
      if (extension === ".m3u8" || extension === ".mpd") {
        body = Buffer.from(extension === ".m3u8" ? playlist(body.toString()) : manifest(body.toString()));
        if (ended) finalManifests++; else liveManifests++;
      } else mediaRequests++;
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": body.length,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  return {
    origin: `http://localhost:${port}`,
    reset() {
      ended = false;
      liveManifests = finalManifests = mediaRequests = 0;
      startTime = new Date(Date.now() - 60_000).toISOString();
    },
    finalize() { ended = true; },
    counts() { return { liveManifests, finalManifests, mediaRequests }; },
    close() {
      server.closeAllConnections();
      return new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    },
  };
}
