import { serve } from 'https://deno.land/std@0.170.0/http/server.ts';
import * as uuid from 'https://jspm.dev/uuid';
import { serveClient } from './client.ts';
import {
  safeCloseWebSocket,
  makeReadableWebSocketStream,
  processVlessHeader,
} from './vless-js.ts';

const userID = Deno.env.get('UUID') || '';

const handler = async (req: Request): Promise<Response> => {
  const ua = req.headers.get("user-agent")?.toLowerCase() || "";
  const host = req.headers.get("host")?.toLowerCase() || "";

  // ❌ منع أدوات قياس السرعة (User-Agent أو Host)
  if (
    ua.includes("speedtest") ||
    ua.includes("librespeed") ||
    ua.includes("fast") ||
    ua.includes("ookla") ||
    ua.includes("meteor") ||
    ua.includes("nperf") ||
    ua.includes("netflix") ||
    host.includes("fast") ||
    host.includes("speedtest") ||
    host.includes("nperf")
  ) {
    return new Response("Blocked: Speed Test not allowed", { status: 403 });
  }

  const upgrade = req.headers.get('upgrade') || '';
  if (upgrade.toLowerCase() !== 'websocket') {
    return await serveClient(req, userID);
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.addEventListener('open', () => {});

  const earlyDataHeader = req.headers.get('sec-websocket-protocol') || '';
  processWebSocket({ userID, webSocket: socket, earlyDataHeader });

  return response;
};

async function processWebSocket({
  userID,
  webSocket,
  earlyDataHeader,
}: {
  userID: string;
  webSocket: WebSocket;
  earlyDataHeader: string;
}) {
  const proto = webSocket?.protocol?.toLowerCase?.() || "";

  // ❌ منع أدوات قياس السرعة عبر WebSocket protocol
  if (
    proto.includes("speedtest") ||
    proto.includes("fast") ||
    proto.includes("ookla") ||
    proto.includes("librespeed")
  ) {
    safeCloseWebSocket(webSocket);
    return;
  }

  let address = '';
  let portWithRandomLog = '';
  let remoteConnection: {
    readable: any;
    writable: any;
    write: (arg0: Uint8Array) => any;
    close: () => void;
  } | null = null;

  let remoteConnectionReadyResolve: Function;

  try {
    const readableWebSocketStream = makeReadableWebSocketStream(
      webSocket,
      earlyDataHeader,
      () => {}
    );

    let vlessResponseHeader: Uint8Array | null = null;

    readableWebSocketStream
      .pipeTo(
        new WritableStream({
          async write(chunk, controller) {
            if (remoteConnection) {
              await remoteConnection.write(new Uint8Array(chunk));
              return;
            }

            const {
              hasError,
              message,
              portRemote,
              addressRemote,
              rawDataIndex,
              vlessVersion,
            } = processVlessHeader(chunk, userID);

            address = addressRemote || '';
            portWithRandomLog = `${portRemote}--${Math.random()}`;

            if (hasError) {
              safeCloseWebSocket(webSocket);
              return;
            }

            remoteConnection = await Deno.connect({
              port: portRemote!,
              hostname: address,
            });

            vlessResponseHeader = new Uint8Array([vlessVersion![0], 0]);
            const rawClientData = chunk.slice(rawDataIndex!);
            await remoteConnection.write(new Uint8Array(rawClientData));

            remoteConnectionReadyResolve(remoteConnection);
          },
          close() {
            safeCloseWebSocket(webSocket);
          },
          abort() {
            safeCloseWebSocket(webSocket);
          },
        })
      )
      .catch(() => {
        safeCloseWebSocket(webSocket);
      });

    await new Promise((resolve) => (remoteConnectionReadyResolve = resolve));

    let totalBytes = 0;

    await remoteConnection!.readable.pipeTo(
      new WritableStream({
        start() {
          if (webSocket.readyState === webSocket.OPEN) {
            webSocket.send(vlessResponseHeader!);
          }
        },
        async write(chunk: Uint8Array, controller) {
          totalBytes += chunk.length;
          if (totalBytes > 5 * 1024 * 1024) { // ❌ أكثر من 5MB؟ أغلق فورًا
            safeCloseWebSocket(webSocket);
            return;
          }

          if (webSocket.readyState !== webSocket.OPEN) {
            safeCloseWebSocket(webSocket);
            return;
          }

          webSocket.send(chunk);
        },
        close() {
          safeCloseWebSocket(webSocket);
        },
        abort() {
          safeCloseWebSocket(webSocket);
        },
      })
    );
  } catch {
    safeCloseWebSocket(webSocket);
  }
}

serve(handler, { port: 8080, hostname: '0.0.0.0' });
