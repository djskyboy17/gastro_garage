export type RecurringContent = {
  start:string;end:string;time:string;weekdays:number[];excludedDates:string[];note:string;
  items:{productId:string;quantity:number}[];
};
export type RecurringTemplate = RecurringContent & {id:string;name:string;customerId:string;active:number;revision:number;createdAt:string};
export type Occurrence = {id:string;templateId:string;day:string;orderId:string;runId:string;templateRevision:number};
export type RecurringData = {templates:RecurringTemplate[];occurrences:Occurrence[]};
export const emptyRecurring:RecurringData={templates:[],occurrences:[]};
export type RecurringPreview = {quote:string;templateId:string;revision:number;from:string;to:string;customerName:string;address:string;phone:string;time:string;note:string;items:{productId:string;hu:string;ro:string;allergens:string;quantity:number;price:number;recipeId:string|null}[];days:{date:string;orderId:string;existingOrderId:string|null}[];totalPerOrder:number};
export function validDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T12:00:00Z");return !isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function matchingDates(template:RecurringContent,from:string,to:string){
  if(!validDate(from)||!validDate(to)||from>to)throw new Error("RECURRING_RANGE");
  const first=new Date(from+"T12:00:00Z"),last=new Date(to+"T12:00:00Z");
  if((last.getTime()-first.getTime())/86400000>30)throw new Error("RECURRING_RANGE");
  const result:string[]=[];
  for(const date=new Date(first);date<=last;date.setUTCDate(date.getUTCDate()+1)){
    const day=date.toISOString().slice(0,10),weekday=date.getUTCDay()||7;
    if(day>=template.start&&day<=template.end&&template.weekdays.includes(weekday)&&!template.excludedDates.includes(day))result.push(day);
  }
  return result;
}
export const recurringOrderId=(templateId:string,day:string)=>`recurring:${templateId}:${day}`;
