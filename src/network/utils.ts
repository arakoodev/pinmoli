import os from 'os';

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
