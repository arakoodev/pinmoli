import os from 'os';
import http from 'http';

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
  return '127.0.0.1';
}

export function getPublicIp(): Promise<string> {
  return new Promise((resolve) => {
    http.get('http://ifconfig.me/ip', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve(getLocalIp()));
  });
}
