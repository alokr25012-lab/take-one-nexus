/**
 * utils/security/urlValidator.js
 * 
 * Strict URL validator to mitigate Server-Side Request Forgery (SSRF).
 * Ensures only outbound requests to secure, public, external HTTPS endpoints are permitted.
 */

'use strict';

const { URL } = require('url');

/**
 * Validates whether a URL is secure and points to a public, external HTTPS destination.
 * 
 * @param {string} urlString - The URL string to validate.
 * @returns {boolean} True if the URL is valid, HTTPS, and not internal/private.
 */
function isValidSecureUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    
    // Allow only HTTPS protocol
    if (parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Reject localhost and loopback domains
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return false;
    }

    // Parse IPv4 address
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);
    
    if (ipv4Match) {
      const parts = ipv4Match.slice(1).map(Number);
      if (parts.some(p => p > 255)) {
        return false; // Invalid IP format
      }
      
      const [p1, p2, p3, p4] = parts;
      
      // Loopback: 127.0.0.0/8
      if (p1 === 127) return false;
      
      // Private range Class A: 10.0.0.0/8
      if (p1 === 10) return false;
      
      // Private range Class B: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
      if (p1 === 172 && p2 >= 16 && p2 <= 31) return false;
      
      // Private range Class C: 192.168.0.0/16
      if (p1 === 192 && p2 === 168) return false;
      
      // Link-local (e.g. AWS metadata): 169.254.0.0/16
      if (p1 === 169 && p2 === 254) return false;
      
      // Unspecified/Broadcast: 0.0.0.0
      if (p1 === 0 && p2 === 0 && p3 === 0 && p4 === 0) return false;
    }

    // Clean brackets for IPv6 if present
    const cleanHost = hostname.replace(/^\[|\]$/g, '');
    
    // IPv6 Loopback: ::1
    if (cleanHost === '::1' || cleanHost === '0:0:0:0:0:0:0:1') return false;
    
    // IPv6 Unspecified: ::
    if (cleanHost === '::' || cleanHost === '0:0:0:0:0:0:0:0') return false;
    
    // IPv6 Link-local: fe80::/10
    if (cleanHost.startsWith('fe80:')) return false;
    
    // IPv6 Unique Local Address: fc00::/7
    if (cleanHost.startsWith('fc00:') || cleanHost.startsWith('fd00:')) return false;

    // IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1 or ::ffff:c0a8:101)
    if (cleanHost.startsWith('::ffff:')) {
      const hexPart = cleanHost.substring(7);
      if (hexPart.includes('.')) {
        return isValidSecureUrl(`https://${hexPart}`);
      }
      
      const blocks = hexPart.split(':');
      if (blocks.length === 2) {
        const b1 = blocks[0].padStart(4, '0');
        const b2 = blocks[1].padStart(4, '0');
        
        const p1 = parseInt(b1.substring(0, 2), 16);
        const p2 = parseInt(b1.substring(2, 4), 16);
        const p3 = parseInt(b2.substring(0, 2), 16);
        const p4 = parseInt(b2.substring(2, 4), 16);
        
        if (!isNaN(p1) && !isNaN(p2) && !isNaN(p3) && !isNaN(p4)) {
          return isValidSecureUrl(`https://${p1}.${p2}.${p3}.${p4}`);
        }
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { isValidSecureUrl };
