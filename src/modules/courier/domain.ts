import type {Order} from '../shared/domain';
import {orderFulfillment} from '../fulfillment/domain.ts';
export type CourierTask={id:string;customerName:string;address:string;phone:string;date:string;time:string;windowEnd:string;note:string;production:string;delivery:string;revision:number;items:{hu:string;ro:string;quantity:number;allergens:string}[];events:{kind:string;note:string;createdAt:string}[]};
export type CourierTasks={date:string;courier:{name:string;vehicle:string};tasks:CourierTask[]};

export function courierTask(order:Order):CourierTask{
  const {id,customerName,address,phone,date,time,note,production,delivery,revision}=order;
  return {id,customerName,address,phone,date,time,note,production,delivery,revision,windowEnd:orderFulfillment(order)?.end??'',items:order.items.map(({hu,ro,quantity,allergens})=>({hu,ro,quantity,allergens})),events:[]};
}
export function navigationUrl(address:string){return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address);}
export function phoneUrl(phone:string){const number=phone.replace(/[ ()-]/g,'');return /^\+?[0-9]{6,20}$/.test(number)?'tel:'+number:null;}
