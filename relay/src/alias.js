// snugcode — alamat publik (snugcode.<akun>.workers.dev). File PWA disajikan langsung dari static
// assets worker ini; sisanya (API, login, WebSocket HP & PC) diteruskan apa adanya ke worker relay
// lewat service binding. Relay & datanya (akun, PC tertaut) tetap di worker lama, jadi tidak ada
// migrasi data; host asli request dipertahankan sehingga link & callback OAuth memakai alamat ini.
export default {
  /** @param {Request} request @param {{ RELAY: { fetch: (r: Request) => Promise<Response> } }} env */
  fetch(request, env) {
    return env.RELAY.fetch(request);
  },
};
