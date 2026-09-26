const assets: Record<string, string> = { logo: '/static/logo.svg' };
export function assetsIndex() {
  return { status: 200, body: assets };
}
