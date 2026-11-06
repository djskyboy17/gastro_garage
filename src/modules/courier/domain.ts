import type {Order} from '../shared/domain';
import {orderFulfillment} from '../fulfillment/domain.ts';
export type CourierTask={id:string;customerName:string;address:string;phone:string;date:string;time:string;windowEnd:string;note:string;production:string;delivery:string;revision:number;items:{hu:string;ro:string;quantity:number;allergens:string}[];events:{kind:string;note:string;createdAt:string}[];/** v76: a rendelés hátraléka baniban (a beszedendő összeg). */due:number;/** v77: havi gyűjtőszámlás ügyfél – a futár nem szed pénzt. */onAccount?:boolean;avizAvailable?:boolean;/** v90: a rendeléskor megadott fizetési mód (ha van, a futárnak nem kell újra választania). */expectedPaymentMethod?:""|"cash"|"card"};
export type CourierTasks={date:string;courier:{name:string;vehicle:string};tasks:CourierTask[];/** v76: a futárnál lévő, még le nem adott készpénz (bani). */cashOnHand:number};

export function courierTask(order:Order):CourierTask{
  const {id,customerName,address,phone,date,time,note,production,delivery,revision}=order;
  return {id,customerName,address,phone,date,time,note,production,delivery,revision,windowEnd:orderFulfillment(order)?.end??'',items:order.items.map(({hu,ro,quantity,allergens})=>({hu,ro,quantity,allergens})),events:[],due:0,expectedPaymentMethod:order.expectedPaymentMethod??""};
}
export function navigationUrl(address:string){return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address);}
export function courierOrderVisible(order: Pick<Order, "status" | "fulfillmentMode" | "date" | "delivery">, date: string, currentDay: string) {
  return order.status === "confirmed" && order.fulfillmentMode !== "pickup" &&
    (order.date === date || order.delivery === "transit" || (order.date < currentDay && order.delivery !== "delivered"));
}
export function phoneUrl(phone:string){const number=phone.replace(/[ ()-]/g,'');return /^\+?[0-9]{6,20}$/.test(number)?'tel:'+number:null;}
