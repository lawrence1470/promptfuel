-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "projectName" TEXT NOT NULL,
    "appDescription" TEXT,
    "storageUrl" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "buildMetadata" JSONB NOT NULL,
    "expoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "BuildSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildFile" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,

    CONSTRAINT "BuildFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_name_idx" ON "Post"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BuildSession_sessionId_key" ON "BuildSession"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildSession_shareToken_key" ON "BuildSession"("shareToken");

-- CreateIndex
CREATE INDEX "BuildSession_userId_idx" ON "BuildSession"("userId");

-- CreateIndex
CREATE INDEX "BuildSession_shareToken_idx" ON "BuildSession"("shareToken");

-- CreateIndex
CREATE INDEX "BuildSession_createdAt_idx" ON "BuildSession"("createdAt");

-- CreateIndex
CREATE INDEX "BuildSession_sessionId_idx" ON "BuildSession"("sessionId");

-- CreateIndex
CREATE INDEX "BuildFile_fileHash_idx" ON "BuildFile"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "BuildFile_sessionId_filePath_key" ON "BuildFile"("sessionId", "filePath");

-- AddForeignKey
ALTER TABLE "BuildFile" ADD CONSTRAINT "BuildFile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BuildSession"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;
