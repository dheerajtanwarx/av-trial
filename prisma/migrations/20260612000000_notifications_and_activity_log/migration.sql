-- CreateTable
CREATE TABLE `activity_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(100) NOT NULL,
    `actorType` ENUM('CUSTOMER', 'ADMIN', 'SYSTEM') NOT NULL,
    `actorId` INTEGER NULL,
    `entityType` VARCHAR(50) NOT NULL,
    `entityId` INTEGER NULL,
    `meta` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_logs_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `activity_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `activity_logs_actorType_actorId_createdAt_idx`(`actorType`, `actorId`, `createdAt`),
    INDEX `activity_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('NEW_ORDER', 'ORDER_CANCELLED', 'PAYMENT_SUCCESS', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'ORDER_STATUS_CHANGE', 'DELIVERY_UPDATE', 'SYSTEM_ALERT') NOT NULL,
    `priority` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'INFO') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `orderId` INTEGER NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `notifications_priority_createdAt_idx`(`priority`, `createdAt`),
    INDEX `notifications_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_recipients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `notificationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `readAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_recipients_userId_archivedAt_readAt_idx`(`userId`, `archivedAt`, `readAt`),
    UNIQUE INDEX `notification_recipients_notificationId_userId_key`(`notificationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

