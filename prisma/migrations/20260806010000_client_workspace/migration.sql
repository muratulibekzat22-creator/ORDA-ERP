ALTER TABLE "Client" ADD COLUMN "whatsapp" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Client" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ClientInteraction" (
  "id" SERIAL NOT NULL,
  "clientId" INTEGER NOT NULL,
  "authorId" INTEGER,
  "authorName" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientInteraction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientAttachment" (
  "id" SERIAL NOT NULL,
  "clientId" INTEGER NOT NULL,
  "uploadedById" INTEGER,
  "fileName" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientAttachment_pathname_key" ON "ClientAttachment"("pathname");
CREATE INDEX "ClientInteraction_clientId_createdAt_idx" ON "ClientInteraction"("clientId", "createdAt");
CREATE INDEX "ClientAttachment_clientId_createdAt_idx" ON "ClientAttachment"("clientId", "createdAt");
ALTER TABLE "ClientInteraction" ADD CONSTRAINT "ClientInteraction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientInteraction" ADD CONSTRAINT "ClientInteraction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientAttachment" ADD CONSTRAINT "ClientAttachment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAttachment" ADD CONSTRAINT "ClientAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
