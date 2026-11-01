-- v50: az idősávonkénti rendelésszám-korlát megszűnt, ezért a beszúráskori ellenőrző trigger is.
DROP TRIGGER IF EXISTS `order_fulfillment_capacity`;
