import {
  parseActiveTableOrderListV1,
  parseActiveTableOrderListV2,
  parseAddOrderItemCommandV1,
  parseCancelOrderItemCommandV1,
  parseCreateOrderCommandV1,
  parseCreateOrderCommandV2,
  parseOpenOrderCommandV1,
  parseOrderMutationSummaryV1,
  parseTransitionOrderItemCommandV1,
} from "./index.js";

const scope={restaurantId:"1e37ae13-8507-484c-969f-2176f77b7000",branchId:"23723e10-c0bf-49fd-9363-4f0e2c60e955"};
const common={schemaVersion:1,scope,orderId:"ee50f0f6-746f-47cb-8383-ad7834ef3ef0",eventId:"e74df54b-30a7-449b-a23f-c4ca6f93bda4",idempotencyKey:"order-attempt-1",deviceId:"a72573ec-6224-4857-bc4a-f3d1d07b6d83",occurredAt:"2026-09-02T22:00:00.000Z"};
const expect=(condition:boolean,message:string):void=>{if(!condition)throw new Error(message);};

expect(parseCreateOrderCommandV1({...common,channel:"table",tableId:"d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",currency:"MXN",timeZone:"America/Mexico_City"})!==undefined,"table order parses");
expect(parseCreateOrderCommandV1({...common,channel:"counter",tableId:null,currency:"MXN",timeZone:"UTC"})!==undefined,"counter order parses");
expect(parseCreateOrderCommandV1({...common,channel:"table",tableId:null,currency:"MXN",timeZone:"UTC"})===undefined,"table requires tableId");
expect(parseCreateOrderCommandV1({...common,channel:"counter",tableId:"d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",currency:"MXN",timeZone:"UTC"})===undefined,"counter rejects tableId");

const add={...common,expectedVersion:1,orderItemId:"9544c299-d25b-44ce-98ed-d30116610887",productId:"d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",quantity:2,modifierGroups:[{groupId:"a409ec59-9f5e-496d-a45d-b83a46b49674",selections:[{optionId:"c483b6e7-e102-4cc5-a887-d30712c85e52",quantity:1}]}]};
const parsedAdd=parseAddOrderItemCommandV1(add);
expect(parsedAdd!==undefined && Object.isFrozen(parsedAdd.modifierGroups) && Object.isFrozen(parsedAdd.modifierGroups[0]?.selections),"add item parses frozen");
expect(parseAddOrderItemCommandV1({...add,quantity:0})===undefined,"zero quantity fails");
expect(parseAddOrderItemCommandV1({...add,modifierGroups:[...add.modifierGroups,...add.modifierGroups]})===undefined,"duplicate group fails");
expect(parseOpenOrderCommandV1({...common,expectedVersion:1})!==undefined,"open command parses");
expect(parseTransitionOrderItemCommandV1({...common,expectedVersion:2,orderItemId:add.orderItemId,to:"ready"})!==undefined,"forward transition parses");
expect(parseTransitionOrderItemCommandV1({...common,expectedVersion:2,orderItemId:add.orderItemId,to:"cancelled"})===undefined,"sensitive cancellation not exposed by this slice");

const summary={schemaVersion:1,scope,orderId:common.orderId,version:3,orderStatus:"open",replayed:false,kdsEvent:null};
expect(parseOrderMutationSummaryV1(summary)!==undefined,"order mutation summary parses");
expect(parseOrderMutationSummaryV1({...summary,version:0})===undefined,"order mutation summary requires positive version");
expect(parseOrderMutationSummaryV1({...summary,unexpected:true})===undefined,"order mutation summary rejects extra keys");

const accessor={...common,channel:"counter",tableId:null,currency:"MXN",timeZone:"UTC"};
Object.defineProperty(accessor,"currency",{enumerable:true,get:()=>{throw new Error("must not run");}});
expect(parseCreateOrderCommandV1(accessor)===undefined,"accessor fails without invocation");
expect(parseAddOrderItemCommandV1(new Proxy(add,{ownKeys:()=>{throw new Error("hostile");}}))===undefined,"proxy fails closed");

const operationalScope={restaurantId:"9d2c4e60-1a73-4cf5-8b09-2f6d4a8c1357",branchId:"6b8f2d41-3c75-4e90-9a26-5d1b7c4f8032"};
const operationalTableId="4a7d1c95-2e68-4b30-8f14-9c5d2a7e6031";
const operationalShiftId="7c3e9a20-5d61-4f84-a237-1b6d8e4c9052";
const createV2={
  schemaVersion:2,
  scope:operationalScope,
  orderId:"2f6a8d31-7c45-4e90-b128-3d5f9a6c7042",
  shiftId:operationalShiftId,
  channel:"table",
  tableId:operationalTableId,
  currency:"MXN",
  timeZone:"America/Hermosillo",
  eventId:"8e4b1c70-6a32-4d95-9f18-2c7d5a3b6041",
  idempotencyKey:"operational-order-attempt-1",
  deviceId:"3a9f5d20-8c61-4b74-a235-6e1d7c4f9028",
  occurredAt:"2026-09-05T19:00:00.000Z",
};
expect(parseCreateOrderCommandV2(createV2)!==undefined,"operational order v2 parses");
expect(parseCreateOrderCommandV1(createV2)===undefined,"v1 rejects the additive shift contract");
expect(parseCreateOrderCommandV2({...createV2,schemaVersion:1})===undefined,"v2 requires its explicit schema version");
expect(parseCreateOrderCommandV2({...createV2,shiftId:"invalid"})===undefined,"v2 requires a UUID shift");

const activeOrder={
  orderId:createV2.orderId,
  tableId:operationalTableId,
  shiftId:operationalShiftId,
  status:"open",
  version:3,
  itemCount:2,
  updatedAt:"2026-09-05T19:05:00.000Z",
};
const activeList={schemaVersion:1,scope:operationalScope,tableId:operationalTableId,orders:[activeOrder]};
const parsedActiveList=parseActiveTableOrderListV1(activeList);
expect(parsedActiveList!==undefined && Object.isFrozen(parsedActiveList.orders),"active table orders parse frozen");
expect(parseActiveTableOrderListV1({...activeList,orders:[activeOrder,{...activeOrder}]})===undefined,"duplicate active orders fail");
expect(parseActiveTableOrderListV1({...activeList,orders:[{...activeOrder,tableId:"5d1a7c30-9e62-4f84-b205-8c3d6a1f9074"}]})===undefined,"another table fails");
expect(parseActiveTableOrderListV1({...activeList,orders:[{...activeOrder,status:"paid"}]})===undefined,"inactive status fails");
expect(parseActiveTableOrderListV1({...activeList,orders:[{...activeOrder,shiftId:null}]})!==undefined,"legacy unlinked order remains visible");
const sparseOrders:unknown[]=[];
sparseOrders.length=1;
expect(parseActiveTableOrderListV1({...activeList,orders:sparseOrders})===undefined,"sparse active order list fails closed");

const activeItem={
  orderItemId:add.orderItemId,
  productId:add.productId,
  productName:"Arrachera al carbón",
  quantity:2,
  status:"pending",
  unit:"pieza",
  unitPrice:{amountMinor:12500,currency:"MXN"},
  modifiers:[{
    groupId:add.modifierGroups[0]?.groupId,
    groupName:"Término",
    optionId:add.modifierGroups[0]?.selections[0]?.optionId,
    optionName:"Bien cocido",
    quantity:1,
    unitPrice:{amountMinor:0,currency:"MXN"},
  }],
};
const activeOrderV2={...activeOrder,itemCount:1,currency:"MXN",items:[activeItem]};
const activeListV2={schemaVersion:2,scope:operationalScope,tableId:operationalTableId,orders:[activeOrderV2]};
const parsedActiveListV2=parseActiveTableOrderListV2(activeListV2);
expect(parsedActiveListV2!==undefined && Object.isFrozen(parsedActiveListV2.orders)
  && Object.isFrozen(parsedActiveListV2.orders[0]?.items)
  && Object.isFrozen(parsedActiveListV2.orders[0]?.items[0]?.modifiers),"active table order lines parse deeply frozen");
expect(parseActiveTableOrderListV1(activeListV2)===undefined,"v1 rejects the active line response v2");
expect(parseActiveTableOrderListV2({...activeListV2,schemaVersion:1})===undefined,"active lines require schema v2");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{...activeOrderV2,itemCount:2}]})===undefined,"item count must match lines");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{...activeOrderV2,items:[activeItem,{...activeItem}]}]})===undefined,"duplicate active lines fail");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{
  ...activeOrderV2,
  items:[{...activeItem,unitPrice:{amountMinor:12500,currency:"USD"}}],
}]})===undefined,"line money must keep the order currency");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{
  ...activeOrderV2,
  items:[{...activeItem,modifiers:[{...activeItem.modifiers[0],unitPrice:{amountMinor:0,currency:"USD"}}]}],
}]})===undefined,"modifier money must keep the order currency");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{
  ...activeOrderV2,
  items:[{...activeItem,modifiers:[activeItem.modifiers[0],{...activeItem.modifiers[0],groupId:null,groupName:null}]}],
}]})!==undefined,"active reads preserve repeated historical option snapshots without inventing uniqueness");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{...activeOrderV2,shiftId:null}]})!==undefined,"v2 keeps legacy unlinked orders visible");
expect(parseActiveTableOrderListV2({...activeListV2,orders:[{...activeOrderV2,items:new Array(101).fill(activeItem),itemCount:101}]})===undefined,"active line response is bounded");

const cancellation={...common,expectedVersion:2,orderItemId:add.orderItemId,reason:"Producto equivocado"};
expect(parseCancelOrderItemCommandV1(cancellation)!==undefined,"item cancellation with an explicit reason parses");
expect(parseCancelOrderItemCommandV1({...cancellation,reason:" "})===undefined,"blank cancellation reason fails");
expect(parseCancelOrderItemCommandV1({...cancellation,authorization:{approved:true}})===undefined,"client cannot supply authorization evidence");
