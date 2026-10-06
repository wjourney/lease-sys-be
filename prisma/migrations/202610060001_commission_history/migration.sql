-- Keep archived commission schedules when an order switches payment mode.
-- New schedules are exclusively generated while holding the order row lock.
CREATE INDEX `commissions_orderId_mode_periodStart_idx` ON `commissions` (`orderId`, `mode`, `periodStart`);
DROP INDEX `commissions_orderId_mode_periodStart_key` ON `commissions`;
