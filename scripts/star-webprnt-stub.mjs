#!/usr/bin/env node
/**
 * Star WebPRNT mock printer (KitchenBoost dev / E2E).
 *
 * The real Star printer is a LAN device that POSTs are sent to at
 * `http://<ip>/StarWebPRNT/SendMessage`. For E2E on the emulator we don't
 * have a real printer — this stub listens on the same path, pretty-prints
 * the ticket payload to the console (so you can SEE what would have been
 * printed), and answers a Star-shaped success XML so the native verdict
 * matches `{ kind: "ok" }`.
 *
 * USAGE
 *   node scripts/star-webprnt-stub.mjs            # listens on 0.0.0.0:9999
 *   PORT=8080 node scripts/star-webprnt-stub.mjs  # custom port
 *
 * From the Android emulator, the host machine is reachable at `10.0.2.2`,
 * so configure the printer URL inside the app as:
 *   http://10.0.2.2:9999/StarWebPRNT/SendMessage
 *
 * Any POST to that path is logged with timestamp + decoded ticket body.
 * Any other path returns 404. Ctrl-C to stop.
 *
 * No dependencies — Node builtins only (http + URL + querystring).
 */

import http from "node:http";

const PORT = Number(process.env.PORT ?? 9999);
const HOST = process.env.HOST ?? "0.0.0.0";
const CANONICAL_PATH = "/StarWebPRNT/SendMessage";

const STAR_SUCCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <status code="100" online="true" coverOpen="false" paperEmpty="false" />
  <success>true</success>
</response>`;

function colour(code, text) {
  if (!process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}
const dim = (s) => colour("2", s);
const green = (s) => colour("32", s);
const yellow = (s) => colour("33", s);
const cyan = (s) => colour("36", s);
const red = (s) => colour("31", s);
const bold = (s) => colour("1", s);

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function extractTicketText(rawBody) {
  // The native client POSTs `request=<urlencoded XML>` —
  // see buildStarWebPrntRequestBody.
  let xml = rawBody;
  if (rawBody.startsWith("request=")) {
    try {
      xml = decodeURIComponent(rawBody.slice("request=".length));
    } catch {
      // fall through, return raw
    }
  }
  // Strip the SBP envelope: <data><text>...</text></data>
  const match = xml.match(/<text>([\s\S]*?)<\/text>/);
  if (match) {
    return match[1]
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'");
  }
  return xml;
}

function prettyPrintTicket(ticket) {
  const lines = ticket.split("\n");
  const width = Math.max(...lines.map((l) => l.length), 32);
  const border = "+" + "-".repeat(width + 2) + "+";
  console.log(green(border));
  for (const line of lines) {
    if (line.trim() === "") {
      console.log(green("| ") + " ".repeat(width) + green(" |"));
      continue;
    }
    const padded = line.padEnd(width, " ");
    console.log(green("| ") + padded + green(" |"));
  }
  console.log(green(border));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "?";
  const ts = timestamp();

  if (req.method === "POST" && req.url === CANONICAL_PATH) {
    const body = await readBody(req);
    const ticket = extractTicketText(body);

    console.log(
      `\n${dim(ts)} ${cyan(bold("PRINT"))} ${dim("from " + remote)}  ${yellow("(" + body.length + " bytes)")}`,
    );
    prettyPrintTicket(ticket);

    res.writeHead(200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(STAR_SUCCESS_XML);
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html><body><h1>Star WebPRNT mock</h1><p>POST <code>${CANONICAL_PATH}</code> with <code>request=&lt;urlencoded XML&gt;</code> body.</p></body></html>`,
    );
    return;
  }

  console.log(
    `${dim(ts)} ${red("MISS")}  ${req.method} ${req.url} ${dim("from " + remote)}`,
  );
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log(green(bold("  Star WebPRNT mock printer")));
  console.log(
    dim(
      `  Listening on  http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}${CANONICAL_PATH}`,
    ),
  );
  console.log(dim(`  Android emu   http://10.0.2.2:${PORT}${CANONICAL_PATH}`));
  console.log(dim("  Ctrl-C to stop"));
  console.log("");
});

server.on("error", (err) => {
  console.error(red(`Server error: ${err.message}`));
  if (/EADDRINUSE/.test(err.message)) {
    console.error(
      red(
        `Port ${PORT} is busy. Try PORT=9998 node scripts/star-webprnt-stub.mjs`,
      ),
    );
  }
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n" + dim("  Stopped."));
  process.exit(0);
});
