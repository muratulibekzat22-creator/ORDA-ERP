CREATE UNIQUE INDEX "PayrollAccrual_measurement_bonus_order_key"
ON "PayrollAccrual"("orderId")
WHERE "type" = 'MEASUREMENT_BONUS' AND "orderId" IS NOT NULL;
