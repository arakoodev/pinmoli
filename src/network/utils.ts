import os from 'os';
import dgram from 'dgram';

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  throw new Error(
    'No routable IPv4 interface found. ' +
    'SIP/SDP headers require a real IP — 127.0.0.1 is unreachable from remote peers.'
  );
}

/**
 * Discover public IP via STUN (RFC 5389).
 * Uses a temporary socket. Falls back to getLocalIp() if STUN fails.
 */
export async function getPublicIp(stunServer = 'stun.l.google.com', stunPort = 19302): Promise<string> {
  const socket = dgram.createSocket('udp4');
  try {
    const result = await stunDiscoverAddress(socket, stunServer, stunPort);
    return result.ip;
  } finally {
    try { socket.close(); } catch (_e) { /* already closed */ }
  }
}

/**
 * Discover the NAT-mapped address of an EXISTING socket via STUN (RFC 5389).
 * The socket must already be bound. Returns the public IP and port as seen
 * by the STUN server — which is the address remote peers should send to.
 * Falls back to the socket's local address if STUN fails.
 */
export async function stunDiscoverAddress(
  socket: dgram.Socket,
  stunServer = 'stun.l.google.com',
  stunPort = 19302,
): Promise<{ ip: string; port: number }> {
  return new Promise((resolve) => {
    const localAddr = socket.address();
    const fallback = { ip: getLocalIp(), port: localAddr.port };

    const timeout = setTimeout(() => {
      socket.off('message', handler);
      resolve(fallback);
    }, 3000);

    // STUN Binding Request
    const txnId = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) txnId[i] = Math.floor(Math.random() * 256);
    const request = Buffer.alloc(20);
    request.writeUInt16BE(0x0001, 0);
    request.writeUInt16BE(0, 2);
    request.writeUInt32BE(0x2112A442, 4);
    txnId.copy(request, 8);

    const handler = (msg: Buffer) => {
      const parsed = parseStunResponse(msg);
      if (!parsed) return; // Not a STUN response — ignore
      clearTimeout(timeout);
      socket.off('message', handler);
      resolve(parsed);
    };

    socket.on('message', handler);

    socket.on('error', () => {
      clearTimeout(timeout);
      socket.off('message', handler);
      resolve(fallback);
    });

    socket.send(request, stunPort, stunServer);
  });
}

/**
 * Parse STUN Binding Response for XOR-MAPPED-ADDRESS or MAPPED-ADDRESS.
 * Returns both IP and port.
 */
function parseStunResponse(msg: Buffer): { ip: string; port: number } | null {
  if (msg.length < 20) return null;
  const type = msg.readUInt16BE(0);
  if (type !== 0x0101) return null; // Not a Binding Success Response

  const length = msg.readUInt16BE(2);
  let offset = 20;
  const end = 20 + length;

  while (offset + 4 <= end) {
    const attrType = msg.readUInt16BE(offset);
    const attrLen = msg.readUInt16BE(offset + 2);
    const attrStart = offset + 4;

    if (attrType === 0x0020 && attrLen >= 8) {
      // XOR-MAPPED-ADDRESS
      const family = msg.readUInt8(attrStart + 1);
      if (family === 0x01) { // IPv4
        const xorPort = msg.readUInt16BE(attrStart + 2);
        const xorAddr = msg.readUInt32BE(attrStart + 4);
        const port = xorPort ^ 0x2112;
        const addr = xorAddr ^ 0x2112A442;
        const ip = `${(addr >>> 24) & 0xFF}.${(addr >>> 16) & 0xFF}.${(addr >>> 8) & 0xFF}.${addr & 0xFF}`;
        return { ip, port };
      }
    } else if (attrType === 0x0001 && attrLen >= 8) {
      // MAPPED-ADDRESS (fallback)
      const family = msg.readUInt8(attrStart + 1);
      if (family === 0x01) {
        const ip = `${msg.readUInt8(attrStart + 4)}.${msg.readUInt8(attrStart + 5)}.${msg.readUInt8(attrStart + 6)}.${msg.readUInt8(attrStart + 7)}`;
        const port = msg.readUInt16BE(attrStart + 2);
        return { ip, port };
      }
    }

    offset = attrStart + attrLen;
    // STUN attributes are padded to 4-byte boundaries
    if (offset % 4 !== 0) offset += 4 - (offset % 4);
  }

  return null;
}
