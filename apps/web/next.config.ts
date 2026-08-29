import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'Origin-Agent-Cluster', value: '?1' }],
    }];
  },
  transpilePackages: [
    '@infratwin/model',
    '@infratwin/graph-engine',
    '@infratwin/evidence',
    '@infratwin/scenarios',
    '@infratwin/webmcp',
    '@infratwin/optimizer',
  ],
};

export default nextConfig;
