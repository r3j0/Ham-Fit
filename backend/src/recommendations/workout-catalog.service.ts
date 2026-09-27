import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { validateCatalog } from './catalog.js';
import type { RecommendationCatalog } from './catalog.js';

@Injectable()
export class WorkoutCatalogService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async activate(input: RecommendationCatalog) {
    // Validate the entire source before a single database mutation. Never normalize/drop bad rows.
    const catalog = validateCatalog(input);
    return this.database.$transaction(
      async (tx) => {
        // A transaction-scoped global import lock protects first import and pointer switch.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(701921734)`;
        const existing = await tx.workoutCatalog.findUnique({
          where: { version: catalog.version },
        });
        if (existing && existing.contentHash !== catalog.contentHash)
          throw new Error(
            'Catalog version already exists with different content; use a new version.',
          );
        if (!existing) {
          await tx.workoutCatalog.create({
            data: {
              version: catalog.version,
              sourceCommit: catalog.sourceCommit,
              sourceUrls: catalog.sourceUrls,
              checkedOn: new Date(`${catalog.checkedOn}T00:00:00Z`),
              contentHash: catalog.contentHash,
            },
          });
          await tx.workoutVideo.createMany({
            data: catalog.videos.map((video) => ({
              ...video,
              catalogVersion: catalog.version,
              fitnessWeights: video.fitnessWeights as Prisma.InputJsonValue,
            })),
          });
          await tx.workoutCurriculum.createMany({
            data: catalog.videos.map((video) => ({
              name: video.title,
              catalogVersion: catalog.version,
              videoId: video.videoId,
            })),
          });
        }
        await tx.workoutCatalogActivation.upsert({
          where: { id: 'current' },
          create: { id: 'current', catalogVersion: catalog.version },
          update: { catalogVersion: catalog.version, activatedAt: new Date() },
        });
        return {
          version: catalog.version,
          videoCount: catalog.videos.length,
          reused: Boolean(existing),
        };
      },
      { timeout: 30000 },
    );
  }
}
