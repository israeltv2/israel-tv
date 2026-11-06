// Nord Israel HTTPS proxy settings, read from the environment (never printed).
export const NORD_IL_SERVERS = [
  'il100',
  'il93',
  'il94',
  'il95',
  'il96',
  'il97',
  'il98',
  'il99',
  'il101',
  'il102',
];

export function nordProxy(server: string): { server: string; username: string; password: string } {
  const username = process.env.NORD_USER;
  const password = process.env.NORD_PASS;
  if (!username || !password) throw new Error('NORD_USER / NORD_PASS missing from the environment (.env)');
  return { server: `https://${server}.proxy.nordvpn.com:89`, username, password };
}
