/*
  Warnings:

  - You are about to drop the `Test` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[phone]` on the table `OtpToken` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `OtpToken` MODIFY `phone` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` MODIFY `email` VARCHAR(191) NULL,
    MODIFY `password_hash` VARCHAR(191) NULL,
    MODIFY `phone` VARCHAR(191) NULL,
    MODIFY `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER';

-- DropTable
DROP TABLE `Test`;

-- CreateIndex
CREATE UNIQUE INDEX `OtpToken_phone_key` ON `OtpToken`(`phone`);

-- CreateIndex
CREATE UNIQUE INDEX `User_phone_key` ON `User`(`phone`);
