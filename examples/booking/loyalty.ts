export interface PointGrant {
  ownerId: string;
  points: number;
  expiresAtDay: number;
}

const grants: PointGrant[] = [];

export function grantPoints(ownerId: string, points: number, today: number): void {
  grants.push({ ownerId, points, expiresAtDay: today + 365 });
}

export function activePoints(ownerId: string, today: number): number {
  return grants.filter(grant => grant.ownerId === ownerId && grant.expiresAtDay >= today)
    .reduce((sum, grant) => sum + grant.points, 0);
}
