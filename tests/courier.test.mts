import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {courierTask,navigationUrl,phoneUrl} from '../src/modules/courier/domain.ts';
// @ts-ignore
import {isMember,tabsFor,canWrite,projectData} from '../src/modules/access/domain.ts';
// @ts-ignore
import type {Order,AppData} from '../src/modules/shared/domain.ts';
test('Courier task projection exposes operational details without private/financial fields',()=>{
 const order={id:'o',customerId:'private-id',customerName:'Example',address:'Example address',phone:'0000000000',date:'2026-10-29',time:'12:00',note:'Dietary note',production:'ready',delivery:'pending',revision:2,payment:'paid',deliveryFee:900,fulfillmentPostalCode:'000000',fulfillmentSnapshot:JSON.stringify({end:'13:00',fee:900}),courierId:'secret',portalUserId:'private-user',items:[{hu:'Dish',ro:'Preparat',quantity:2,allergens:'milk',price:1000,recipeId:'private-recipe',productId:'private-product'}]} as Order;
 const task=courierTask(order);assert.equal(task.windowEnd,'13:00');assert.equal(task.items[0].quantity,2);
 for(const key of ['payment','deliveryFee','customerId','courierId','portalUserId','fulfillmentSnapshot','fulfillmentPostalCode'])assert.equal(key in task,false);
 for(const key of ['price','recipeId','productId'])assert.equal(key in task.items[0],false);
 assert.equal(isMember('courier'),false);assert.deepEqual(tabsFor('courier'),[]);assert.equal(canWrite('courier','/api/orders/state',{field:'delivery'}),false);
 const empty=projectData({orders:[order]} as AppData,'courier');assert.deepEqual(empty.orders,[]);assert.deepEqual(empty.products,[]);
});
test('Navigation encodes destination text, phone links reject control and URI characters',()=>{
 assert.equal(navigationUrl('Strada A & B / 2'),'https://www.google.com/maps/dir/?api=1&destination=Strada%20A%20%26%20B%20%2F%202');
 assert.equal(phoneUrl('+40 (700) 123-456'),'tel:+40700123456');assert.equal(phoneUrl('javascript:alert(1)'),null);assert.equal(phoneUrl('123\n456'),null);
});
