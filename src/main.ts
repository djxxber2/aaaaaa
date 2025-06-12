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
    const log = (info: string, event?: any) => {};

    const readableWebSocketStream = makeReadableWebSocketStream(
      webSocket,
      earlyDataHeader,
      log
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
              console.error(`[${address}:${portWithRandomLog}] ${message}`);
              safeCloseWebSocket(webSocket);
              controller.error(message);
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
          close() {},
          abort(reason) {},
        })
      )
      .catch((error) => {
        console.error(
          `[${address}:${portWithRandomLog}] readableWebSocketStream pipeto has exception`,
          error.stack || error
        );
      });

    await new Promise((resolve) => (remoteConnectionReadyResolve = resolve));

    await remoteConnection!.readable.pipeTo(
      new WritableStream({
        start() {
          if (webSocket.readyState === webSocket.OPEN) {
            webSocket.send(vlessResponseHeader!);
          }
        },
        async write(chunk: Uint8Array, controller) {
          if (webSocket.readyState !== webSocket.OPEN) {
            controller.error(
              `can't send to WebSocket, it's already closed by client`
            );
            return;
          }
          webSocket.send(chunk);
        },
        close() {},
        abort(reason) {
          safeCloseWebSocket(webSocket);
          console.error(
            `[${address}:${portWithRandomLog}] remoteConnection readable aborted`,
            reason
          );
        },
      })
    );
  } catch (error: any) {
    console.error(
      `[${address}:${portWithRandomLog}] processWebSocket exception`,
      error.stack || error
    );
    safeCloseWebSocket(webSocket);
  }
}

serve(handler, { port: 8080, hostname: '0.0.0.0' });
