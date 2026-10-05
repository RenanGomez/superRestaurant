import {
  parseActiveTableOrderListV1,
  parseActiveTableOrderListV2,
  ORDER_DETAIL_ACTIONS,
  parseAddOrderItemCommandV1,
  parseAssignOrderWaiterCommandV1,
  parseAssignOrderWaiterResultV1,
  parseCancelOrderItemCommandV1,
  parseCreateOrderCommandV1,
  parseCreateOrderCommandV2,
  parseOpenOrderCommandV1,
  parseOrderDetailRequestV1,
  parseOrderDetailV1,
  parseOrderMutationSummaryV1,
  parseSendOrderToKitchenCommandV1,
  parseTableBoardV1,
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
const sendToKitchenItemIds=[add.orderItemId];
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:1,orderItemIds:sendToKitchenItemIds})!==undefined,"send-to-kitchen command parses");
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:0,orderItemIds:sendToKitchenItemIds})===undefined,"send-to-kitchen command requires a positive expectedVersion");
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:1,orderItemIds:[]})===undefined,"send-to-kitchen command rejects empty orderItemIds");
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:1,orderItemIds:[add.orderItemId,add.orderItemId]})===undefined,"send-to-kitchen command rejects duplicate orderItemIds");
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:1,orderItemIds:["not-a-uuid"]})===undefined,"send-to-kitchen command rejects non-uuid orderItemIds");
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:1})===undefined,"send-to-kitchen command requires orderItemIds");
expect(parseSendOrderToKitchenCommandV1({...common,expectedVersion:1,orderItemIds:sendToKitchenItemIds,extra:true})===undefined,"send-to-kitchen command rejects extra keys");
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
expect(parseCreateOrderCommandV2({...createV2,shiftId:null})!==undefined,"tables-board: null shiftId means server-resolved shift");

const assignWaiterCommand={
  schemaVersion:1,
  scope:operationalScope,
  orderId:createV2.orderId,
  expectedVersion:1,
  waiterUserId:"4b2b7e4d-6a2a-4f8f-9a0d-2d6a9f1b7c3e",
  eventId:"6d4c2b1a-3f9e-4c7d-8b2a-1e5f7c9d3a6b",
  idempotencyKey:"assign-waiter-attempt-1",
  deviceId:"3a9f5d20-8c61-4b74-a235-6e1d7c4f9028",
  occurredAt:"2026-09-05T19:05:00.000Z",
};
expect(parseAssignOrderWaiterCommandV1(assignWaiterCommand)!==undefined,"assign waiter command parses");
expect(parseAssignOrderWaiterCommandV1({...assignWaiterCommand,waiterUserId:null})!==undefined,"assign waiter command accepts null (clear waiter)");
expect(parseAssignOrderWaiterCommandV1({...assignWaiterCommand,waiterUserId:"invalid"})===undefined,"assign waiter rejects a non-UUID waiter");
expect(parseAssignOrderWaiterCommandV1({...assignWaiterCommand,expectedVersion:0})===undefined,"assign waiter requires a positive expectedVersion");

const assignWaiterResult={
  schemaVersion:1,
  scope:operationalScope,
  orderId:createV2.orderId,
  version:2,
  waiterUserId:assignWaiterCommand.waiterUserId,
  replayed:false,
};
expect(parseAssignOrderWaiterResultV1(assignWaiterResult)!==undefined,"assign waiter result parses");
expect(parseAssignOrderWaiterResultV1({...assignWaiterResult,waiterUserId:null})!==undefined,"assign waiter result accepts a cleared waiter");

const tableBoard={
  schemaVersion:1,
  scope:operationalScope,
  unassignedOrders:[{
    tableId:"6d8e0f32-5c4b-4a7e-9b2d-0c3f8e6a4b71",
    orderId:"7e9f1a43-6d5c-4b8f-8c3e-1d4a9f7b5c82",
    status:"draft",
    version:1,
    waiterUserId:null,
    openedAt:"2026-09-05T19:00:00.000Z",
  }],
  tables:[{
    tableId:operationalTableId,
    status:"occupied",
    activeOrders:[{
      orderId:createV2.orderId,
      status:"open",
      version:2,
      waiterUserId:assignWaiterCommand.waiterUserId,
      openedAt:"2026-09-05T19:00:00.000Z",
    }],
  },{
    tableId:"5c7d9e21-4b3a-4f6d-8a1c-9b2e7d5f3a60",
    status:"free",
    activeOrders:[],
  }],
};
expect(parseTableBoardV1(tableBoard)!==undefined,"table board parses");
const freeTable=(index:number)=>({tableId:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,status:"free",activeOrders:[]});
const manyTables=(count:number)=>Array.from({length:count},(_,index)=>freeTable(index+1));
expect(parseTableBoardV1({...tableBoard,tables:manyTables(501)})?.tables.length===501,"a board with 501 tables (above the old cap) parses");
expect(parseTableBoardV1({...tableBoard,tables:manyTables(50_000)})?.tables.length===50_000,"a board at the layout ceiling parses");
expect(parseTableBoardV1({...tableBoard,tables:manyTables(50_001)})===undefined,"a board above the layout ceiling is rejected");
expect(parseTableBoardV1(tableBoard)?.unassignedOrders[0]?.tableId==="6d8e0f32-5c4b-4a7e-9b2d-0c3f8e6a4b71","unassigned orders keep their table id");
expect(parseTableBoardV1({...tableBoard,unassignedOrders:[{...tableBoard.unassignedOrders[0],status:"paid"}]})===undefined,"unassigned orders must be active");
expect(parseTableBoardV1({schemaVersion:1,scope:operationalScope,tables:[]})===undefined,"unassignedOrders is required");
expect(parseTableBoardV1({...tableBoard,tables:[{...tableBoard.tables[0],status:"free"}]})===undefined,"a free table cannot carry active orders");
expect(parseTableBoardV1({...tableBoard,tables:[{...tableBoard.tables[1],status:"occupied"}]})===undefined,"an occupied table requires at least one active order");

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

const detailRequest={schemaVersion:1,scope,orderId:common.orderId};
expect(parseOrderDetailRequestV1(detailRequest)!==undefined,"order detail request parses");
expect(parseOrderDetailRequestV1({...detailRequest,orderId:"not-a-uuid"})===undefined,"order detail request rejects a malformed orderId");

const detailItem={orderItemId:add.orderItemId,status:"pending",name:"Tacos al pastor",quantity:2,unitPriceMinor:5000,lineTotalMinor:10000,note:null,modifiers:[],availableActions:["cancelItem"]};
const detail={
  schemaVersion:1,scope,orderId:common.orderId,status:"open",channel:"table",
  tableId:"d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",currency:"MXN",timeZone:"America/Mexico_City",
  createdAt:"2026-09-02T22:00:00.000Z",updatedAt:"2026-09-02T22:05:00.000Z",version:2,
  items:[detailItem],
  totals:{currency:"MXN",itemsTotalMinor:10000,deliveryChargeMinor:0,tipMinor:0,totalMinor:10000},
  fulfillment:{channel:"table",tableId:"d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",customerLabel:null,addressLabel:null,paymentIntent:null},
  availableActions:["sendToKitchen","cancelItem"],
};
expect(parseOrderDetailV1(detail)!==undefined,"order detail parses");
expect(parseOrderDetailV1({...detail,fulfillment:{...detail.fulfillment,channel:"counter"}})===undefined,"fulfillment.channel must match the order's own channel");
expect(parseOrderDetailV1({...detail,totals:{...detail.totals,totalMinor:10001}})===undefined,"order detail totals must add up exactly");
expect(parseOrderDetailV1({...detail,availableActions:["sendToKitchen","sendToKitchen"]})===undefined,"order detail rejects duplicate actions");
expect(parseOrderDetailV1({...detail,availableActions:["not-an-action"]})===undefined,"order detail rejects an unknown action");
const parsedDetail=parseOrderDetailV1(detail);
expect(parsedDetail!==undefined && parsedDetail.items[0]?.availableActions[0]==="cancelItem","order detail keeps each line's own availableActions");
expect(parseOrderDetailV1({...detail,items:[{...detailItem,availableActions:["cancelItem","cancelItem"]}]})===undefined,"a line's availableActions rejects duplicates");

const variantUuid="6a1d2c3e-4f50-4a61-8b72-93a4b5c6d7e8";
expect(parsedAdd!==undefined && parsedAdd.variantId===null && parsedAdd.note===null,"add item normalizes absent variantId and note to null");
const parsedSized=parseAddOrderItemCommandV1({...add,variantId:variantUuid,note:"sin cebolla"});
expect(parsedSized!==undefined && parsedSized.variantId===variantUuid && parsedSized.note==="sin cebolla","add item accepts variantId and note");
expect(parseAddOrderItemCommandV1({...add,variantId:variantUuid})?.note===null,"variantId alone parses");
expect(parseAddOrderItemCommandV1({...add,note:null,variantId:null})!==undefined,"explicit nulls parse");
expect(parseAddOrderItemCommandV1({...add,variantId:"not-a-uuid"})===undefined,"bad variantId fails");
expect(parseAddOrderItemCommandV1({...add,note:"x".repeat(501)})===undefined,"long note fails");
expect(parseAddOrderItemCommandV1({...add,note:"line"+String.fromCharCode(10)+"break"})===undefined,"control characters in note fail");
expect(parseAddOrderItemCommandV1({...add,note:""})===undefined,"empty note fails");
expect((ORDER_DETAIL_ACTIONS as readonly string[]).includes("addItem"),"addItem is a detail action");
