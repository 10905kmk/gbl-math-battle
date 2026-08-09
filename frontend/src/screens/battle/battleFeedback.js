export function hasLocalDamage(events, selfId) {
  return Array.isArray(events) && events.some(
    (event) => (event?.type === 'hit' || event?.type === 'reflect')
      && event.targetId === selfId
      && Number(event.damage) > 0,
  );
}
