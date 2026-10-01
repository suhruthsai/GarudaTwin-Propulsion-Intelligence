// Gateway (server.js) address: direct on localhost, otherwise through the Vite/reverse proxy (same origin)
export const GATEWAY_URL = (typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? `http://${window.location.hostname}:5002`
  : '';

/** fetch() against the gateway; `path` is relative to the gateway root, e.g. '/api/rl-replan' */
export const gatewayFetch = (path, options = {}) => fetch(`${GATEWAY_URL}${path}`, options);
