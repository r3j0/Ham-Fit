BEGIN;

-- Extend the public catalog without rewriting existing preferences or timestamps.
ALTER TYPE "OwnedTool" ADD VALUE 'ball';
ALTER TYPE "OwnedTool" ADD VALUE 'cone';
ALTER TYPE "OwnedTool" ADD VALUE 'agility_ladder';
ALTER TYPE "OwnedTool" ADD VALUE 'bosu';

COMMIT;
