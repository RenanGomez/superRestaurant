"use server";
import { cookies } from "next/headers";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { requestCapture, type CaptureOperation, type CaptureRequestResult } from "../../../lib/capture-workspace";
import { customerOperations, requestCustomerDirectory } from "../../../lib/customer-directory";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import type { CaptureMutationResultV1, CaptureWorkspaceV1, CaptureWorkTrayResultV1, CustomerDirectoryDetailV1, CustomerDirectorySearchResultV1 } from "@super-restaurant/shared-types";
export type CaptureWorkspaceOperation=CaptureOperation|"search"|"detail";
export type CaptureWorkspaceResult=CaptureRequestResult<CaptureMutationResultV1|CaptureWorkspaceV1|CaptureWorkTrayResultV1|CustomerDirectorySearchResultV1|CustomerDirectoryDetailV1>&{readonly command?:unknown};
export async function captureWorkspaceAction(operation:CaptureWorkspaceOperation,input:unknown):Promise<CaptureWorkspaceResult>{
 const supabase=await createServerSupabaseClient();const {data:{session}}=await supabase.auth.getSession();if(session===null)return{ok:false,error:"denied"};
 const scope=parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);if(scope===undefined)return{ok:false,error:"denied"};
 const env=getServerEnv();const memberships=await listMemberships(session.access_token,env.apiBaseUrl);if(memberships===undefined||findMembership(memberships.memberships,scope)===undefined||await authorizeBranch(session.access_token,env.apiBaseUrl,scope)===undefined)return{ok:false,error:"denied"};
 if(operation==="search"||operation==="detail"){const parser=customerOperations[operation].input;const parsed=parser(input);if(parsed===undefined||parsed.scope.restaurantId!==scope.restaurantId||parsed.scope.branchId!==scope.branchId)return{ok:false,error:"invalid"};return requestCustomerDirectory(session.access_token,env.apiBaseUrl,operation,parsed);}
 const body=typeof input==="object"&&input!==null?input as{scope?:{restaurantId?:string;branchId?:string}}:{};if(!("scope" in body)||body.scope?.restaurantId!==scope.restaurantId||body.scope.branchId!==scope.branchId)return{ok:false,error:"invalid"};
 const result=await requestCapture(session.access_token,env.apiBaseUrl,operation,input);return result.ok?result:{...result,command:result.error==="unavailable"?input:undefined};
}
