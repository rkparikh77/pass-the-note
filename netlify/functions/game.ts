import { getStore } from '@netlify/blobs';
import { createGameHandler } from '../../room-service.mjs';

// Standard function URL: /.netlify/functions/game. Runtime credentials are
// supplied by Netlify automatically; there is no user-managed key or database.
export default async (request: Request): Promise<Response> => {
  const store = getStore({ name: 'pass-the-note-rooms', consistency: 'strong' });
  return createGameHandler({ store })(request);
};
