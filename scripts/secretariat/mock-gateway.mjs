#!/usr/bin/env node
// A stand-in for the Secretariat gateway (#43) for end-to-end tests of hosted mode: speaks the
// Anthropic Messages API (streaming and non-streaming) and answers every request with a fixed text.
// It checks the bearer token and logs one line per request (method, path, model, auth ok) to stderr.
//
//   node scripts/secretariat/mock-gateway.mjs [--port 0] [--token <token>] [--reply <text>]
//
// Prints `listening <url>` on stdout once ready.
import { createServer } from "node:http";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const port = Number(option("port", "0"));
const token = option("token", "mock-gateway-token");
const reply = option("reply", "OK");

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function sse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const raw = await readBody(request);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // Logged below as a bad request.
  }
  const presented =
    request.headers["x-api-key"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const authOk = presented === token;
  process.stderr.write(
    `${JSON.stringify({ method: request.method, path: url.pathname, model: body.model ?? null, stream: body.stream === true, authOk })}\n`,
  );

  if (!authOk) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "bad token" },
      }),
    );
    return;
  }
  if (request.method !== "POST" || !url.pathname.endsWith("/v1/messages")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ type: "error", error: { type: "not_found_error", message: url.pathname } }),
    );
    return;
  }

  const id = `msg_mock_${Date.now()}`;
  const model = body.model ?? "mock-model";
  const usage = { input_tokens: 10, output_tokens: 1 };
  if (body.stream !== true) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: reply }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage,
      }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(response, "message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  sse(response, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  sse(response, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: reply },
  });
  sse(response, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(response, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  sse(response, "message_stop", { type: "message_stop" });
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`listening http://127.0.0.1:${address.port}\n`);
});
