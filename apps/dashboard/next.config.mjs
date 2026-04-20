/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app-motoristas/shared-types'],
  typedRoutes: true,
};

export default nextConfig;
