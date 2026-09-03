import { parseAddOrderItemCommandV1, parseCreateOrderCommandV1, parseOpenOrderCommandV1, parseOrderMutationSummaryV1, parseTransitionOrderItemCommandV1 } from "./index.js";

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
