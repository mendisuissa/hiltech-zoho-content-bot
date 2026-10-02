import { holdHiltech } from './actionSecurity';

// Old free-text privileged forwarding has no delegated capability contract.
export async function executeHiltechKernelTask(_text:string):Promise<any>{holdHiltech();}

// Only trusted startup supplies this boundary. Callers receive an execution
// handle, never kernel credentials or arbitrary text/capability forwarding.
export function createScopedKernelClient(boundary:any) {
  if(!boundary||typeof boundary.execute!=='function')throw Error('P0_KERNEL_SCOPE_REQUIRED');
  return Object.freeze({execute:(req:any,request:any)=>boundary.execute(req,request)});
}
