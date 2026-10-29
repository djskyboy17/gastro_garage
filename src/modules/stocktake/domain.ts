export type CountSnapshot={hu:string;ro:string;unit:string;batch:string;expires:string;supplier:string;document:string;quantity:number;totalCost:number};
export type CountLine={id:string;stocktakeId:string;lotId:string;snapshot:CountSnapshot;expected:number;lotRevision:number;counted:number|null;note:string};
export type Stocktake={id:string;title:string;status:string;revision:number;createdBy:string;createdAt:string;postedBy:string;postedAt:string;closedBy:string;closedAt:string;closeNote:string;lines:CountLine[]};
export type StocktakeData={stocktakes:Stocktake[]};
export function countDelta(expected:number,counted:number){
  if(!Number.isSafeInteger(expected)||expected<0||!Number.isSafeInteger(counted)||counted<0||counted>10000000)throw Error('STOCKTAKE_QUANTITY');
  return counted-expected;
}
export function readyToPost(lines:CountLine[]){
  if(!lines.length)throw Error('STOCKTAKE_INCOMPLETE');
  for(const line of lines){if(line.counted===null)throw Error('STOCKTAKE_INCOMPLETE');if(countDelta(line.expected,line.counted)!==0&&!line.note.trim())throw Error('STOCKTAKE_NOTE');}
}
