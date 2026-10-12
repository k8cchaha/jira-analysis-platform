-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" DATETIME,
    "jiraCloudId" TEXT NOT NULL
);
INSERT INTO "new_User" ("email", "id", "image", "name", "jiraCloudId")
SELECT "email", "id", "image", "name", '' FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
DROP TABLE "JiraToken";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
