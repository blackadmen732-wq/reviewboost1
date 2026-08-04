import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyDevice,
  describeDevice,
  fingerprintDevice,
  networkOf,
} from '../../src/domain/deviceFingerprint.js';

const hasher = (value, domain) => `${domain}:${value}`;

describe('describeDevice', () => {
  it('identifies common browser and platform combinations', () => {
    const cases = [
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', 'Chrome on macOS'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Version/17.0 Safari/604.1', 'Safari on iOS'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64) Gecko/20100101 Firefox/121.0', 'Firefox on Windows'],
      ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', 'Chrome on Android'],
      ['curl/8.4.0', 'API client on Unknown OS'],
    ];

    for (const [userAgent, expected] of cases) {
      assert.equal(describeDevice(userAgent), expected);
    }
  });

  it('does not mistake Edge or Opera for Chrome', () => {
    // Both include "Chrome/" in their user agent, so ordering matters.
    assert.match(
      describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0'),
      /^Edge/,
    );
    assert.match(
      describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 OPR/106.0'),
      /^Opera/,
    );
  });

  it('does not mistake Chrome for Safari', () => {
    // Chrome's user agent also contains "Safari/".
    assert.match(
      describeDevice('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'),
      /^Chrome/,
    );
  });

  it('handles a missing user agent', () => {
    assert.equal(describeDevice(''), 'Unknown device');
    assert.equal(describeDevice(null), 'Unknown device');
    assert.equal(describeDevice('   '), 'Unknown device');
  });
});

describe('classifyDevice', () => {
  it('separates mobile, tablet, desktop, and bot', () => {
    assert.equal(classifyDevice('Mozilla/5.0 (iPhone) Mobile Safari'), 'mobile');
    assert.equal(classifyDevice('Mozilla/5.0 (iPad) Safari'), 'tablet');
    assert.equal(classifyDevice('Mozilla/5.0 (Macintosh) Chrome'), 'desktop');
    assert.equal(classifyDevice('Googlebot/2.1'), 'bot');
    assert.equal(classifyDevice('HeadlessChrome/120'), 'bot');
    assert.equal(classifyDevice(''), 'unknown');
  });
});

describe('networkOf', () => {
  it('reduces IPv4 to a /24', () => {
    assert.equal(networkOf('203.0.113.42'), '203.0.113.0/24');
    assert.equal(networkOf('10.0.0.1'), '10.0.0.0/24');
  });

  it('reduces IPv6 to its routing prefix', () => {
    assert.equal(networkOf('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3:8d3');
  });

  it('unwraps the IPv4-mapped IPv6 form some proxies report', () => {
    // Node reports ::ffff:203.0.113.42 behind certain proxies; treating that as
    // a different network would flag every such request as a new device.
    assert.equal(networkOf('::ffff:203.0.113.42'), '203.0.113.0/24');
  });

  it('handles missing input', () => {
    assert.equal(networkOf(''), 'unknown');
    assert.equal(networkOf(null), 'unknown');
  });
});

describe('fingerprintDevice', () => {
  const agent = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

  it('treats the same browser on the same network as one device', () => {
    // A DHCP lease renewal must not read as a suspicious new sign-in, or users
    // learn to ignore the alert.
    assert.equal(
      fingerprintDevice({ userAgent: agent, ip: '203.0.113.7', hasher }),
      fingerprintDevice({ userAgent: agent, ip: '203.0.113.199', hasher }),
    );
  });

  it('treats a different network as a different device', () => {
    assert.notEqual(
      fingerprintDevice({ userAgent: agent, ip: '203.0.113.7', hasher }),
      fingerprintDevice({ userAgent: agent, ip: '198.51.100.7', hasher }),
    );
  });

  it('treats a different browser as a different device', () => {
    assert.notEqual(
      fingerprintDevice({ userAgent: agent, ip: '203.0.113.7', hasher }),
      fingerprintDevice({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/121.0',
        ip: '203.0.113.7',
        hasher,
      }),
    );
  });

  it('ignores minor version changes, which happen on every auto-update', () => {
    assert.equal(
      fingerprintDevice({ userAgent: agent, ip: '203.0.113.7', hasher }),
      fingerprintDevice({
        userAgent: agent.replace('120.0', '121.0'),
        ip: '203.0.113.7',
        hasher,
      }),
    );
  });

  it('requires a keyed hasher — the inputs are too low-entropy for a plain digest', () => {
    assert.throws(() => fingerprintDevice({ userAgent: agent, ip: '1.2.3.4' }), TypeError);
  });
});
