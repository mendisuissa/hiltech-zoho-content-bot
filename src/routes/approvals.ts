import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireCaller, heldResponse } from '../services/actionSecurity';

// Optional boundary is supplied only by trusted startup, never by HTTP fields.
export function createApprovalsRouter(boundary?:any) {
  const router=Router();
  router.get('/pending',async(req,res,next)=>{
    if(!requireCaller(req,res))return;
    try {
      const rows=await prisma.approvalRequest.findMany({where:{status:'pending'},orderBy:{createdAt:'desc'},select:{id:true,title:true,createdAt:true},take:100});
      return res.json({ok:true,items:rows.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,state:'GENERATED'}))});
    }catch {return res.status(503).json({error:'P0_PENDING_UNAVAILABLE'});}
  });
  for(const action of ['approve','reject'])router.get('/:id/'+action,(_req,res)=>res.status(405).json({error:'P0_MUTATING_GET_REMOVED'}));
  router.post('/:id/approve',async(req,res)=>{
    if(!requireCaller(req,res))return;
    if(!boundary)return heldResponse(res);
    try {
      const body=req.body;
      if(!body||Object.keys(body).sort().join(',')!=='proof,requestId')return res.status(400).json({error:'P0_INVALID_REQUEST'});
      return res.json(await boundary.approve(req,{artifactId:req.params.id,requestId:body.requestId},body.proof));
    }catch{return res.status(403).json({error:'P0_APPROVAL_DENIED'});}
  });
  // Token-based rejection, regeneration and bulk re-send have no valid scoped
  // contract. Preserve URLs with explicit holds rather than unsafe behavior.
  for(const path of ['/:id/reject','/:id/regenerate','/resend-pending'])router.post(path,(req,res)=>{if(requireCaller(req,res))return heldResponse(res);});
  return router;
}
export const approvalsRouter=createApprovalsRouter();
