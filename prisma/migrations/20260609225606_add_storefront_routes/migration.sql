-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `size` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `shippingFee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `shippingMethod` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `badge` VARCHAR(191) NULL,
    ADD COLUMN `comparePrice` DECIMAL(10, 2) NULL,
    ADD COLUMN `isBestseller` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pdpOverride` JSON NULL,
    ADD COLUMN `rating` DOUBLE NULL,
    ADD COLUMN `reviewCount` INTEGER NULL,
    ADD COLUMN `sizes` JSON NULL,
    ADD COLUMN `slug` VARCHAR(191) NOT NULL,
    ADD COLUMN `type` VARCHAR(191) NULL,
    MODIFY `description` TEXT NULL;

-- CreateTable
CREATE TABLE `newsletter_subscribers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `newsletter_subscribers_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `pct` DECIMAL(5, 4) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `minSpend` DECIMAL(10, 2) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `promos_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `products_slug_key` ON `products`(`slug`);

