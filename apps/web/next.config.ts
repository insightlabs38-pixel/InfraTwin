import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
