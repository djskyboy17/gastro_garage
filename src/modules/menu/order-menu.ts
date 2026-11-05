import { SET_CART_ID, SET_GROUP, splitSetPrice, type Product } from "../shared/domain.ts";
import { menuSetError } from "./domain.ts";

export type OrderMenu = { soupId: string; mainId: string; price: number; lineIds: string[] };
export function expandOrderMenu(requested: { productId: string; quantity: number }[], catalog: Product[], menu: OrderMenu | null) {
  const seen = new Set<string>();
  const result: { productId: string; quantity: number; price: number; setGroup: string }[] = [];
  for (const line of requested) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000 || seen.has(line.productId)) throw new Error("INVALID_ITEM");
    seen.add(line.productId);
    if (line.productId === SET_CART_ID) {
      if (!menu || !Number.isInteger(menu.price) || menu.price < 1 || menuSetError(menu, catalog, menu.lineIds)) throw new Error("MENU_SET_UNAVAILABLE");
      const prices = splitSetPrice(menu.price);
      [menu.soupId, menu.mainId].forEach((productId, index) => result.push({ productId, quantity: line.quantity, price: prices[index], setGroup: SET_GROUP }));
    } else {
      const product = catalog.find((product) => product.id === line.productId && product.active);
      if (!product) throw new Error("INVALID_ITEM");
      result.push({ ...line, price: product.price, setGroup: "" });
    }
  }
  if (result.length > 50 || new Set(result.map((line) => line.productId)).size !== result.length) throw new Error("INVALID_ITEM");
  return result;
}
