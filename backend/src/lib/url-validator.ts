import { URL } from 'url';
import { isIP } from 'net';

// Private/internal IP ranges that should be blocked for SSRF protection
const PRIVATE_RANGES = [
  /^127\./,                         // Loopback
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^169\.254\./,                    // Link-local
  /^0\./,                           // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // Carrier-grade NAT
  /^::1$/,                          // IPv6 loopback
  /^fe80:/i,                        // IPv6 link-local
  /^fc00:/i,                        // IPv6 unique local
  /^fd/i,                           // IPv6 unique local
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',       // GCP metadata
  'metadata.google',
  'instance-data',                  // Generic cloud metadata
  '169.254.169.254',                // AWS/GCP/Azure metadata IP
];

function extractMappedIpv4(hostname: string): string | null {
  // IPv6-mapped IPv4: ::ffff:x.x.x.x or ::ffff:0:x.x.x.x
  const match = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(hostname);
  return match ? match[1] : null;
}

function isPrivateIpOrHostname(hostname: string): boolean {
  // Check blocked hostnames
  const lowerHost = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.some(b => lowerHost === b || lowerHost.endsWith('.' + b) || lowerHost.endsWith('.internal') || lowerHost.endsWith('.compute.internal'))) {
    return true;
  }

  // Check for IPv6-mapped IPv4 (bypasses bare IPv4 checks)
  const mappedIpv4 = extractMappedIpv4(hostname);
  if (mappedIpv4 && PRIVATE_RANGES.some(re => re.test(mappedIpv4))) {
    return true;
  }

  // Check if it's a direct IP address in private ranges
  if (isIP(hostname)) {
    return PRIVATE_RANGES.some(re => re.test(hostname));
  }

  return false;
}

/**
 * Validate a user-provided URL for SSRF safety.
 * Allows only http/https/ws/wss and blocks internal/private addresses.
 */
export function validateExternalUrl(urlString: string, label = 'URL'): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid ${label}: not a valid URL`);
  }

  // Only allow safe protocols
  const allowedProtocols = ['http:', 'https:', 'ws:', 'wss:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Invalid ${label}: protocol must be http, https, ws, or wss`);
  }

  // Block private/internal addresses
  if (isPrivateIpOrHostname(parsed.hostname)) {
    throw new Error(`Invalid ${label}: cannot point to private/internal addresses`);
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid ${label}: URLs with embedded credentials are not allowed`);
  }

  return parsed;
}
