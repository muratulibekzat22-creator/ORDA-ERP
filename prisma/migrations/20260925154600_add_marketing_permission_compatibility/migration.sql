-- Preserve existing legacy marketing permission rows without exposing or
-- enabling the unpublished marketing workspace in this release.
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'marketing';
