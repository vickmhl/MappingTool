import type { ChangeEvent, Person } from '../types';
import { createId, nowIso } from './ids';

export function buildStaleEvents(people: Person[], staleAfterDays: number): ChangeEvent[] {
  const now = Date.now();
  const threshold = staleAfterDays * 24 * 60 * 60 * 1000;

  return people
    .filter((person) => now - new Date(person.updatedAt).getTime() > threshold)
    .map((person) => ({
      id: createId('stale'),
      personId: person.id,
      personName: person.name,
      type: 'stale',
      description: `${person.name} 的信息超过 ${staleAfterDays} 天未更新，需要复核。`,
      evidenceIds: person.evidenceIds,
      createdAt: nowIso(),
    }));
}
