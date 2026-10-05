// Connection/session management, separate from the game's rules.
export const DISCONNECT_GRACE = 20000;
export function present(room, id, now) {
  room.presence ??= {};
  room.presence[id] = { lastSeen: now, left: false };
}
export function leave(room, id) {
  room.presence ??= {};
  room.presence[id] = { lastSeen: 0, left: true };
}
export function reconcilePresence(room, now) {
  let changed = false;
  for (const player of room.players) {
    const state = room.presence?.[player.id];
    const connected = !!state && !state.left && now - state.lastSeen < DISCONNECT_GRACE;
    if (player.connected !== connected) { player.connected = connected; changed = true; }
  }
  const hostIndex = room.players.findIndex(p => p.id === room.hostId);
  if (!room.players[hostIndex]?.connected) {
    for (let offset=1;offset<=room.players.length;offset++) {
      const next=room.players[(hostIndex+offset)%room.players.length];
      if (next.connected) { if (room.hostId !== next.id) { room.hostId=next.id; changed=true; } break; }
    }
  }
  if (changed) room.version++;
}
