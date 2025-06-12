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
  if (upgrade.toLowerCase() != 'websocket') {
    return await serveClient(req, userID);
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.addEventListener('open', () => {});

  const earlyDataHeader = req.headers.get('sec-websocket-protocol') || '';

  processWebSocket({
    userID,
    webSocket: socket,
    earlyDataHeader,
  });
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
    const log = (info: string, event?: any) => {
    };
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
            const vlessBuffer = chunk;
            if (remoteConnection) {
              const number = await remoteConnection.write(
                new Uint8Array(vlessBuffer)
              );
              return;
            }
            const {
              hasError,
              message,
              portRemote,
              addressRemote,
              rawDataIndex,
              vlessVersion,
              isUDP,
            } = processVlessHeader(vlessBuffer, userID);
            address = addressRemote || '';
            portWithRandomLog = `${portRemote}--${Math.random()}`;
            
            if (hasError) {
              controller.error(`[${address}:${portWithRandomLog}] ${message} `);
            }
            // console.log(`[${address}:${portWithRandomLog}] connecting`); // Commented out to reduce logs
            remoteConnection = await Deno.connect({
              port: portRemote!,
              hostname: address,
            });
            vlessResponseHeader = new Uint8Array([vlessVersion![0], 0]);
            const rawClientData = vlessBuffer.slice(rawDataIndex!);
            await remoteConnection!.write(new Uint8Array(rawClientData));
            remoteConnectionReadyResolve(remoteConnection);
          },
          close() {
            // console.log(
            //   `[${address}:${portWithRandomLog}] readableWebSocketStream is close`
            // ); // Commented out to reduce logs
          },
          abort(reason) {
            // console.log(
            //   `[${address}:${portWithRandomLog}] readableWebSocketStream is abort`,
            //   JSON.stringify(reason)
            // ); // Commented out to reduce logs
          },
        })
      )
      .catch((error) => {
       
      });
    await new Promise((resolve) => (remoteConnectionReadyResolve = resolve));
    let remoteChunkCount = 0;
    // let totoal = 0; // Commented out as it's not used
    // remote --> ws
    await remoteConnection!.readable.pipeTo(
      new WritableStream({
        start() {
          if (webSocket.readyState === webSocket.OPEN) {
            webSocket.send(vlessResponseHeader!);
          }
        },
        async write(chunk: Uint8Array, controller) {
          function send2WebSocket() {
            if (webSocket.readyState !== webSocket.OPEN) {
              controller.error(
                `can't accept data from remoteConnection!.readable when client webSocket is close early`
              );
              return;
            }
            webSocket.send(chunk);
          }

          remoteChunkCount++;
          send2WebSocket();
        },
        close() {
          // console.log(
          //   `[${address}:${portWithRandomLog}] remoteConnection!.readable is close`
          // ); // Commented out to reduce logs
        },
        abort(reason) {
          safeCloseWebSocket(webSocket);
          console.error(
            `[${address}:${portWithRandomLog}] remoteConnection!.readable abort`,
            reason
          );
        },
      })
    );
  } catch (error: any) {
    console.error(
      `[${address}:${portWithRandomLog}] processWebSocket has exception `,
      error.stack || error
    );
    safeCloseWebSocket(webSocket);
  }
  return;
}

globalThis.addEventListener('beforeunload', (e) => {
  // console.log('About to exit...'); // Commented out to reduce logs
});

globalThis.addEventListener('unload', (e) => {
  // console.log('Exiting'); // Commented out to reduce logs
});
serve(handler, { port: 8080, hostname: '0.0.0.0' });


