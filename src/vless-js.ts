import { stringify } from 'uuid';

export function vlessJs(): string {
  return 'vless-js';
}

const WS_READY_STATE_OPEN = 1;

export function makeReadableWebSocketStream(
  ws: WebSocket | any,
  earlyDataHeader: string,
  log: Function
) {
  let readableStreamCancel = false;

  return new ReadableStream<ArrayBuffer>({
    start(controller) {
      ws.addEventListener('message', (e: { data: ArrayBuffer }) => {
        if (readableStreamCancel) return;
        controller.enqueue(e.data);
      });

      ws.addEventListener('error', (e: any) => {
        log('socket error');
        readableStreamCancel = true;
        controller.error(e);
      });

      ws.addEventListener('close', () => {
        if (readableStreamCancel) return;
        controller.close();
      });

      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        log(`earlyDataHeader invalid base64`);
        safeCloseWebSocket(ws);
        return;
      }
      if (earlyData) {
        controller.enqueue(earlyData);
      }
    },
    cancel(reason) {
      log(`stream cancelled:`, reason);
      if (readableStreamCancel) return;
      readableStreamCancel = true;
      safeCloseWebSocket(ws);
    },
  });
}

function base64ToArrayBuffer(base64Str: string) {
  if (!base64Str) return { error: null };
  try {
    base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

export function safeCloseWebSocket(socket: WebSocket | any) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN) {
      socket.close();
    }
  } catch (error) {
    console.error('safeCloseWebSocket error', error);
  }
}

export function processVlessHeader(
  vlessBuffer: ArrayBuffer,
  userID: string
) {
  if (vlessBuffer.byteLength < 24) {
    return { hasError: true, message: 'invalid data' };
  }

  const version = new Uint8Array(vlessBuffer.slice(0, 1));
  const uuidCheck = stringify(new Uint8Array(vlessBuffer.slice(1, 17)));

  if (uuidCheck !== userID) {
    return { hasError: true, message: 'invalid user' };
  }

  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
  const command = new Uint8Array(
    vlessBuffer.slice(18 + optLength, 18 + optLength + 1)
  )[0];

  if (command !== 1) {
    return { hasError: true, message: 'UDP and MUX not supported. TCP only.' };
  }

  const portIndex = 18 + optLength + 1;
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getInt16(0);

  let addressIndex = portIndex + 2;
  const addressType = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1))[0];
  let addressValueIndex = addressIndex + 1;
  let addressValue = '';

  switch (addressType) {
    case 1: // IPv4
      addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 4)).join('.');
      addressValueIndex += 4;
      break;
    case 2: // Domain
      const len = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + len));
      addressValueIndex += len;
      break;
    case 3: // IPv6
      const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + 16));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(':');
      addressValueIndex += 16;
      break;
    default:
      return { hasError: true, message: `Invalid address type ${addressType}` };
  }

  if (!addressValue) {
    return { hasError: true, message: 'address is empty' };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    portRemote,
    rawDataIndex: addressValueIndex,
    vlessVersion: version,
  };
}
